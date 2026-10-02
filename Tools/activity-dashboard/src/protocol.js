export const FTS = Object.freeze({
  serviceUUID: "0000febb-0000-1000-8000-00805f9b34fb",
  versionUUID: "adaf0001-4669-6c65-5472-616e73666572",
  rawUUID: "adaf0002-4669-6c65-5472-616e73666572",
  readWindow: 4096,
  command: Object.freeze({
    read: 0x10,
    readData: 0x11,
    readPacing: 0x12,
    listDir: 0x50,
    listDirEntry: 0x51,
    digest: 0x70,
    digestStatus: 0x71,
  }),
  status: Object.freeze({
    ok: 0x01,
    error: 0x02,
    noFile: 0x03,
    protocolError: 0x04,
    readOnly: 0x05,
  }),
});

const STATUS_NAMES = new Map([
  [FTS.status.ok, "OK"],
  [FTS.status.error, "watch error"],
  [FTS.status.noFile, "file not found"],
  [FTS.status.protocolError, "protocol error"],
  [FTS.status.readOnly, "read-only filesystem"],
]);

export class FTSProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "FTSProtocolError";
  }
}

export function statusName(status) {
  return STATUS_NAMES.get(status) ?? `unknown status 0x${status.toString(16).padStart(2, "0")}`;
}

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof DataView) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("Expected ArrayBuffer, DataView, or Uint8Array");
}

function pathPacket(command, path, extraLength = 0) {
  const pathBytes = new TextEncoder().encode(path);
  if (pathBytes.length > 0xffff) throw new RangeError("FTS path exceeds 65535 bytes");
  const packet = new Uint8Array(4 + extraLength + pathBytes.length);
  const view = new DataView(packet.buffer);
  packet[0] = command;
  view.setUint16(2, pathBytes.length, true);
  packet.set(pathBytes, 4 + extraLength);
  return { packet, view };
}

export function makeRead(path, offset = 0, size = FTS.readWindow) {
  const { packet, view } = pathPacket(FTS.command.read, path, 8);
  view.setUint32(4, offset, true);
  view.setUint32(8, size, true);
  return packet;
}

export function makeReadPacing(offset, size = FTS.readWindow) {
  const packet = new Uint8Array(12);
  const view = new DataView(packet.buffer);
  packet[0] = FTS.command.readPacing;
  packet[1] = FTS.status.ok;
  view.setUint32(4, offset, true);
  view.setUint32(8, size, true);
  return packet;
}

export function makeListDir(path) {
  return pathPacket(FTS.command.listDir, path).packet;
}

export function makeDigest(path) {
  return pathPacket(FTS.command.digest, path).packet;
}

export function parseReadData(input) {
  const bytes = bytesOf(input);
  if (bytes.length < 16 || bytes[0] !== FTS.command.readData) {
    throw new FTSProtocolError("Malformed READ_DATA response");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkLength = view.getUint32(12, true);
  if (bytes.length < 16 + chunkLength) {
    throw new FTSProtocolError("Truncated READ_DATA response");
  }
  return {
    status: bytes[1],
    offset: view.getUint32(4, true),
    totalLength: view.getUint32(8, true),
    data: bytes.slice(16, 16 + chunkLength),
  };
}

export function parseListDirEntry(input) {
  const bytes = bytesOf(input);
  if (bytes.length < 28 || bytes[0] !== FTS.command.listDirEntry) {
    throw new FTSProtocolError("Malformed LISTDIR_ENTRY response");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const status = bytes[1];
  if (status !== FTS.status.ok) {
    throw new FTSProtocolError(`LISTDIR failed: ${statusName(status)}`);
  }
  const pathLength = view.getUint16(2, true);
  const entryNumber = view.getUint32(4, true);
  const totalEntries = view.getUint32(8, true);
  if (pathLength === 0) {
    if (entryNumber !== totalEntries) {
      throw new FTSProtocolError("Invalid LISTDIR terminator");
    }
    return { kind: "done" };
  }
  if (bytes.length < 28 + pathLength) {
    throw new FTSProtocolError("Truncated LISTDIR_ENTRY name");
  }
  return {
    kind: "entry",
    name: new TextDecoder().decode(bytes.slice(28, 28 + pathLength)),
    isDirectory: (view.getUint32(12, true) & 1) !== 0,
    modificationTimeNs: view.getBigUint64(16, true),
    fileSize: view.getUint32(24, true),
  };
}

export function parseDigestStatus(input) {
  const bytes = bytesOf(input);
  if (bytes.length < 12 || bytes[0] !== FTS.command.digestStatus) {
    throw new FTSProtocolError("Malformed DIGEST_STATUS response");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    status: bytes[1],
    fileSize: view.getUint32(4, true),
    crc32: view.getUint32(8, true),
  };
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC32_TABLE.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  CRC32_TABLE[i] = value >>> 0;
}

export function crc32(input) {
  const bytes = bytesOf(input);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
