import {
  FTS,
  FTSProtocolError,
  crc32,
  makeDigest,
  makeListDir,
  makeRead,
  makeReadPacing,
  parseDigestStatus,
  parseListDirEntry,
  parseReadData,
  statusName,
} from "./protocol.js";

const OPERATION_TIMEOUT_MS = 15_000;
const DEVICE_ID_KEY = "una.activity.watchDeviceId";

export class FTSClient extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.rawCharacteristic = null;
    this.protocolVersion = 0;
    this.pending = null;
    this.skipKnownOnce = false;
    this._onNotification = this._onNotification.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
  }

  static isSupported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  get isConnected() {
    return Boolean(this.device?.gatt?.connected && this.rawCharacteristic);
  }

  async connect() {
    if (!FTSClient.isSupported()) {
      throw new Error("Web Bluetooth is unavailable. Use Bluefy on iPhone or Chrome/Edge on HTTPS or localhost.");
    }
    if (this.isConnected) return;

    const { device, reused } = await this._selectDevice();
    this.device = device;
    device.addEventListener("gattserverdisconnected", this._onDisconnected);

    try {
      this._state("connecting", `Connecting to ${device.name || "Bluetooth device"}`);
      this.server = await device.gatt.connect();
      const service = await this.server.getPrimaryService(FTS.serviceUUID);
      const [versionCharacteristic, rawCharacteristic] = await Promise.all([
        service.getCharacteristic(FTS.versionUUID),
        service.getCharacteristic(FTS.rawUUID),
      ]);

      this.rawCharacteristic = rawCharacteristic;
      await rawCharacteristic.startNotifications();
      rawCharacteristic.addEventListener("characteristicvaluechanged", this._onNotification);

      const versionValue = await versionCharacteristic.readValue();
      if (versionValue.byteLength < 4) throw new Error("Watch returned an invalid FTS version");
      this.protocolVersion = versionValue.getUint32(0, true);
      this.skipKnownOnce = false;
      this._rememberDevice(device);
      this._log(`FTS protocol v${this.protocolVersion}; notifications enabled`);
      this._state("ready", `Connected to ${device.name || "UNA Watch"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (reused) {
        this.skipKnownOnce = true;
        this._log("Known-watch reconnect failed; next Connect will open the device picker");
      }
      if (/ConnectGatt: unable to find appropriate device/i.test(message)) {
        throw new Error("Bluefy remembers the watch permission but cannot retrieve it while the UNA phone connection is active. Disconnect the watch from UNA so it advertises, or use a native iOS client.");
      }
      throw error;
    }
  }

  async _selectDevice() {
    if (!this.skipKnownOnce && typeof navigator.bluetooth.getDevices === "function") {
      this._state("connecting", "Looking for a previously authorized UNA Watch");
      try {
        const devices = await navigator.bluetooth.getDevices();
        const rememberedId = this._rememberedDeviceId();
        const device = devices.find((item) => item.id === rememberedId)
          ?? devices.find((item) => item.name?.toLowerCase().includes("una"))
          ?? (devices.length === 1 ? devices[0] : null);
        if (device) {
          this._log(`Reusing previously authorized device ${device.name || device.id}`);
          return { device, reused: true };
        }
      } catch (error) {
        this._log(`Could not list authorized devices: ${error.message}`);
      }
    }

    this.skipKnownOnce = false;
    this._state("choosing", "Choose your UNA Watch in the browser picker");
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [FTS.serviceUUID],
    });
    return { device, reused: false };
  }

  _rememberedDeviceId() {
    try {
      return localStorage.getItem(DEVICE_ID_KEY);
    } catch {
      return null;
    }
  }

  _rememberDevice(device) {
    if (!device.id) return;
    try {
      localStorage.setItem(DEVICE_ID_KEY, device.id);
    } catch {
      // Storage can be unavailable in a private browsing session.
    }
  }

  disconnect() {
    this._rejectPending(new Error("Disconnected from watch"));
    const device = this.device;
    device?.removeEventListener("gattserverdisconnected", this._onDisconnected);
    this._clearConnection();
    this.device = null;
    if (device?.gatt?.connected) device.gatt.disconnect();
    this._state("idle", "Not connected");
  }

  async listDir(path) {
    return this._startOperation("list", { entries: [] }, makeListDir(path));
  }

  async readFile(path, onProgress = null) {
    return this._startOperation(
      "read",
      {
        chunks: new Map(),
        contiguousEnd: 0,
        totalLength: 0,
        lastPacedOffset: -1,
        onProgress,
      },
      makeRead(path),
    );
  }

  async digest(path) {
    if (this.protocolVersion < 5) {
      throw new Error(`DIGEST requires FTS v5; watch reports v${this.protocolVersion}`);
    }
    return this._startOperation("digest", {}, makeDigest(path));
  }

  async readVerified(path, onProgress = null) {
    const bytes = await this.readFile(path, onProgress);
    if (this.protocolVersion >= 5) {
      const digest = await this.digest(path);
      if (digest.status !== FTS.status.ok) {
        throw new Error(`DIGEST failed: ${statusName(digest.status)}`);
      }
      if (digest.fileSize !== bytes.length || digest.crc32 !== crc32(bytes)) {
        throw new Error("Transfer CRC mismatch. Reconnect and sync the file again.");
      }
    }
    return bytes;
  }

  _startOperation(kind, state, packet) {
    if (!this.isConnected) return Promise.reject(new Error("Connect to the watch first"));
    if (this.pending) return Promise.reject(new Error("Another watch operation is in progress"));

    return new Promise((resolve, reject) => {
      this.pending = { kind, state, resolve, reject, timer: null };
      this._armTimeout();
      this._write(packet).catch((error) => this._rejectPending(error));
    });
  }

  async _write(packet) {
    if (!this.rawCharacteristic) throw new Error("Watch transfer characteristic is unavailable");
    if (typeof this.rawCharacteristic.writeValueWithoutResponse === "function") {
      await this.rawCharacteristic.writeValueWithoutResponse(packet);
    } else {
      await this.rawCharacteristic.writeValue(packet);
    }
    this._armTimeout();
  }

  _onNotification(event) {
    const value = event.target.value;
    if (!this.pending || !value) return;
    this._armTimeout();

    try {
      switch (this.pending.kind) {
        case "list":
          this._handleList(value);
          break;
        case "read":
          this._handleRead(value);
          break;
        case "digest":
          this._handleDigest(value);
          break;
        default:
          break;
      }
    } catch (error) {
      this._rejectPending(error);
    }
  }

  _handleList(value) {
    if (value.getUint8(0) !== FTS.command.listDirEntry) return;
    const item = parseListDirEntry(value);
    if (item.kind === "done") {
      this._resolvePending(this.pending.state.entries);
    } else {
      this.pending.state.entries.push(item);
    }
  }

  _handleRead(value) {
    if (value.getUint8(0) !== FTS.command.readData) return;
    const chunk = parseReadData(value);
    if (chunk.status !== FTS.status.ok) {
      throw new FTSProtocolError(`READ failed: ${statusName(chunk.status)}`);
    }

    const state = this.pending.state;
    if (state.totalLength === 0) state.totalLength = chunk.totalLength;
    if (chunk.totalLength !== state.totalLength) {
      throw new FTSProtocolError("Watch changed total file length during transfer");
    }
    if (chunk.totalLength === 0) {
      this._resolvePending(new Uint8Array());
      return;
    }
    if (chunk.offset > chunk.totalLength) {
      throw new FTSProtocolError("READ_DATA offset exceeds file size");
    }

    let offset = chunk.offset;
    let data = chunk.data;
    const remaining = chunk.totalLength - offset;
    if (data.length > remaining) data = data.slice(0, remaining);

    if (offset < state.contiguousEnd) {
      const overlap = state.contiguousEnd - offset;
      if (overlap >= data.length) data = new Uint8Array();
      else {
        data = data.slice(overlap);
        offset = state.contiguousEnd;
      }
    }
    if (offset >= state.contiguousEnd && data.length > 0) {
      const existing = state.chunks.get(offset);
      if (!existing || existing.length < data.length) state.chunks.set(offset, data);
    }
    while (state.chunks.has(state.contiguousEnd)) {
      state.contiguousEnd += state.chunks.get(state.contiguousEnd).length;
    }

    state.onProgress?.(Math.min(1, state.contiguousEnd / state.totalLength));
    if (state.contiguousEnd >= state.totalLength) {
      const assembled = new Uint8Array(state.totalLength);
      let cursor = 0;
      while (cursor < state.totalLength) {
        const piece = state.chunks.get(cursor);
        if (!piece) throw new FTSProtocolError("READ_DATA left a gap in the file");
        assembled.set(piece, cursor);
        cursor += piece.length;
      }
      this._resolvePending(assembled);
      return;
    }

    if (state.lastPacedOffset !== state.contiguousEnd) {
      state.lastPacedOffset = state.contiguousEnd;
      this._write(makeReadPacing(state.contiguousEnd)).catch((error) => this._rejectPending(error));
    }
  }

  _handleDigest(value) {
    if (value.getUint8(0) !== FTS.command.digestStatus) return;
    this._resolvePending(parseDigestStatus(value));
  }

  _armTimeout() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.timer = setTimeout(() => {
      this._rejectPending(new Error("Watch stopped responding for 15 seconds"));
    }, OPERATION_TIMEOUT_MS);
  }

  _resolvePending(result) {
    if (!this.pending) return;
    const { resolve, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    resolve(result);
  }

  _rejectPending(error) {
    if (!this.pending) return;
    const { reject, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    reject(error);
  }

  _onDisconnected(event) {
    if (event.target !== this.device) return;
    this._rejectPending(new Error("Watch disconnected during transfer"));
    this.device?.removeEventListener("gattserverdisconnected", this._onDisconnected);
    this._clearConnection();
    this.device = null;
    this._state("idle", "Watch disconnected");
    this._log("GATT server disconnected");
  }

  _clearConnection() {
    if (this.rawCharacteristic) {
      this.rawCharacteristic.removeEventListener("characteristicvaluechanged", this._onNotification);
    }
    this.rawCharacteristic = null;
    this.server = null;
    this.protocolVersion = 0;
  }

  _state(state, message) {
    this.dispatchEvent(new CustomEvent("statechange", { detail: { state, message } }));
  }

  _log(message) {
    this.dispatchEvent(new CustomEvent("log", { detail: message }));
  }
}
