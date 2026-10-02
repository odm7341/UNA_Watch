import { FitBaseType, FitEncoder } from "fit-file-parser";

const FIT_EPOCH = (date) => FitEncoder.toFitTimestamp(new Date(date));
const field = (number, size, baseType) => ({ number, size, baseType });
const u8 = (number) => field(number, 1, FitBaseType.Uint8);
const enumField = (number) => field(number, 1, FitBaseType.Enum);
const u16 = (number) => field(number, 2, FitBaseType.Uint16);
const u32 = (number) => field(number, 4, FitBaseType.Uint32);
const s32 = (number) => field(number, 4, FitBaseType.Sint32);

class RawFitWriter {
  constructor() {
    this.data = [];
    this.definitions = new Map();
  }

  define(local, global, fields, developerFields = []) {
    this.data.push(0x40 | (developerFields.length > 0 ? 0x20 : 0) | local, 0, 0, global & 0xff, (global >>> 8) & 0xff, fields.length);
    for (const item of fields) this.data.push(item.number, item.size, item.baseType);
    if (developerFields.length > 0) {
      this.data.push(developerFields.length);
      for (const item of developerFields) this.data.push(item.number, item.size, item.developerDataIndex);
    }
    this.definitions.set(local, { fields, developerFields });
  }

  write(local, values, developerValues = []) {
    const definition = this.definitions.get(local);
    this.data.push(local);
    definition.fields.forEach((item, index) => this.writeValue(item, values[index]));
    definition.developerFields.forEach((item, index) => this.writeValue({ ...item, baseType: FitBaseType.Uint8 }, developerValues[index]));
  }

  writeValue(item, value) {
    if (value instanceof Uint8Array) {
      if (value.byteLength !== item.size) throw new Error(`Expected ${item.size} bytes`);
      this.data.push(...value);
      return;
    }
    const buffer = new ArrayBuffer(item.size);
    const view = new DataView(buffer);
    if (item.baseType === FitBaseType.Enum || item.baseType === FitBaseType.Uint8) view.setUint8(0, value);
    else if (item.baseType === FitBaseType.Uint16) view.setUint16(0, value, true);
    else if (item.baseType === FitBaseType.Uint32) view.setUint32(0, value, true);
    else if (item.baseType === FitBaseType.Sint32) view.setInt32(0, value, true);
    else throw new Error(`Unsupported fixture base type ${item.baseType}`);
    this.data.push(...new Uint8Array(buffer));
  }

  close() {
    const dataSize = this.data.length;
    const header = [14, 0x20, 0x7a, 0x08, dataSize & 0xff, (dataSize >>> 8) & 0xff, (dataSize >>> 16) & 0xff, (dataSize >>> 24) & 0xff, 0x2e, 0x46, 0x49, 0x54];
    const headerCrc = FitEncoder.calculateCRC(header);
    const output = [...header, headerCrc & 0xff, (headerCrc >>> 8) & 0xff, ...this.data];
    const fileCrc = FitEncoder.calculateCRC(output);
    return new Uint8Array([...output, fileCrc & 0xff, (fileCrc >>> 8) & 0xff]);
  }
}

function stringBytes(value, size) {
  const encoded = new TextEncoder().encode(value);
  const bytes = new Uint8Array(size);
  bytes.set(encoded.slice(0, size - 1));
  return bytes;
}

function appId(value) {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode(value).slice(0, 16));
  return bytes;
}

function semicircles(degrees) {
  return Math.round(degrees * (2 ** 31 / 180));
}

function writeFileId(writer, created) {
  writer.define(0, 0, [enumField(0), u16(1), u16(2), u32(4)]);
  writer.write(0, [4, 255, 1, FIT_EPOCH(created)]);
}

function writeLap(writer, local, { start, end, duration, distance = 0, calories = 0, avgHr = 0, maxHr = 0, ascent = 0 }) {
  writer.define(local, 19, [u32(253), u32(2), u32(7), u32(8), u32(9), u16(11), u8(15), u8(16), u16(21), u16(254)]);
  writer.write(local, [FIT_EPOCH(end), FIT_EPOCH(start), duration * 1000, duration * 1000, distance * 100, calories, avgHr, maxHr, ascent, 0]);
}

function writeSession(writer, local, { start, end, duration, sport, subSport, distance = 0, calories = 0, avgHr = 0, maxHr = 0, ascent = 0, index = 0 }) {
  writer.define(local, 18, [u32(253), u32(2), u32(7), u32(8), u32(9), u16(11), enumField(5), enumField(6), u8(16), u8(17), u16(22), u16(26), u16(254)]);
  writer.write(local, [FIT_EPOCH(end), FIT_EPOCH(start), duration * 1000, duration * 1000, distance * 100, calories, sport, subSport, avgHr, maxHr, ascent, 1, index]);
}

function writeActivity(writer, local, end, duration, sessions) {
  writer.define(local, 34, [u32(253), u32(0), u16(1), enumField(2)]);
  writer.write(local, [FIT_EPOCH(end), duration * 1000, sessions, 0]);
}

export function makeSleepFit() {
  const writer = new RawFitWriter();
  const start = "2026-01-02T22:00:00.000Z";
  const end = "2026-01-02T22:01:30.000Z";
  writeFileId(writer, start);

  writer.define(1, 207, [field(1, 16, FitBaseType.Byte), u8(3)]);
  writer.write(1, [appId("SleepVue"), 0]);
  writer.define(2, 206, [u8(0), u8(1), u8(2), field(3, 12, FitBaseType.String), field(8, 1, FitBaseType.String)]);
  writer.write(2, [0, 0, FitBaseType.Uint8, stringBytes("sleep_stage", 12), new Uint8Array(1)]);

  writer.define(3, 20, [u32(253), u8(3)], [{ number: 0, size: 1, developerDataIndex: 0 }]);
  const samples = [
    ["2026-01-02T22:00:00.000Z", 60, 1],
    ["2026-01-02T22:00:30.000Z", 55, 2],
    ["2026-01-02T22:01:00.000Z", 62, 0],
  ];
  for (const [time, heartRate, stage] of samples) writer.write(3, [FIT_EPOCH(time), heartRate], [stage]);
  writeLap(writer, 4, { start, end, duration: 90, avgHr: 59, maxHr: 62 });
  writeSession(writer, 5, { start, end, duration: 90, sport: 0, subSport: 0, avgHr: 59, maxHr: 62 });
  writeActivity(writer, 6, end, 90, 1);
  return writer.close();
}

export function makeWorkoutFit() {
  const writer = new RawFitWriter();
  const start = "2026-01-03T08:00:00.000Z";
  const end = "2026-01-03T08:02:00.000Z";
  writeFileId(writer, start);
  writer.define(1, 20, [u32(253), s32(0), s32(1), u8(3), u8(4), u32(5), u16(7), u32(73), u32(78)]);
  const samples = [
    [start, 0.0100, 0.0200, 120, 80, 0, 180, 3.0, 32],
    ["2026-01-03T08:01:00.000Z", 0.0106, 0.0206, 130, 82, 500, 200, 3.2, 36],
    [end, 0.0112, 0.0212, 140, 84, 1000, 220, 3.5, 40],
  ];
  for (const [time, lat, lon, hr, cadence, distance, power, speed, altitude] of samples) {
    writer.write(1, [FIT_EPOCH(time), semicircles(lat), semicircles(lon), hr, cadence, distance * 100, power, Math.round(speed * 1000), Math.round((altitude + 500) * 5)]);
  }
  writeLap(writer, 2, { start, end, duration: 120, distance: 1000, calories: 75, avgHr: 130, maxHr: 140, ascent: 8 });
  writeSession(writer, 3, { start, end, duration: 120, sport: 1, subSport: 2, distance: 1000, calories: 75, avgHr: 130, maxHr: 140, ascent: 8 });
  writeActivity(writer, 4, end, 120, 1);
  return writer.close();
}

export function makeMultisportFit() {
  const writer = new RawFitWriter();
  const start = "2026-01-04T09:00:00.000Z";
  const middle = "2026-01-04T09:10:00.000Z";
  const end = "2026-01-04T09:30:00.000Z";
  writeFileId(writer, start);
  writeSession(writer, 1, { start, end: middle, duration: 600, sport: 1, subSport: 2, distance: 2000, calories: 110, avgHr: 145, maxHr: 165, ascent: 20, index: 0 });
  writeSession(writer, 2, { start: middle, end, duration: 1200, sport: 2, subSport: 0, distance: 8000, calories: 190, avgHr: 138, maxHr: 158, ascent: 45, index: 1 });
  writeActivity(writer, 3, end, 1800, 2);
  return writer.close();
}
