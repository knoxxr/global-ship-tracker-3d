/**
 * Zero-dependency Mapbox Vector Tile (MVT v2 / Protobuf) Point Decoder.
 * Decodes Open Waters AIS global vector tiles (/v1/vessels/tiles/{z}/{x}/{y})
 * directly into WGS84 geographic coordinates and vessel properties in both
 * Node.js and modern web browsers.
 */

const textDecoder = new TextDecoder('utf-8');

class PbfReader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  readVarint() {
    let result = 0;
    let shift = 0;
    while (this.pos < this.end) {
      const b = this.buf[this.pos++];
      if (shift < 28) {
        result |= (b & 0x7f) << shift;
      } else {
        // Safe JS number arithmetic for values > 2^28 (e.g. 9-digit MMSIs)
        result += (b & 0x7f) * Math.pow(2, shift);
      }
      if ((b & 0x80) === 0) return result;
      shift += 7;
    }
    return result;
  }

  readSVarint() {
    const u = this.readVarint();
    return u % 2 === 1 ? -(u + 1) / 2 : u / 2;
  }

  readString(len) {
    const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }

  readFloat() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readDouble() {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  skip(wireType) {
    if (wireType === 0) {
      this.readVarint();
    } else if (wireType === 1) {
      this.pos += 8;
    } else if (wireType === 2) {
      const len = this.readVarint();
      this.pos += len;
    } else if (wireType === 5) {
      this.pos += 4;
    } else {
      this.pos = this.end;
    }
  }
}

function decodeValue(buf, start, end) {
  const r = new PbfReader(buf, start, end);
  let val = null;
  while (r.pos < r.end) {
    const tag = r.readVarint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) val = r.readString(r.readVarint());
    else if (field === 2 && wire === 5) val = r.readFloat();
    else if (field === 3 && wire === 1) val = r.readDouble();
    else if (field === 4 && wire === 0) val = r.readVarint();
    else if (field === 5 && wire === 0) val = r.readVarint();
    else if (field === 6 && wire === 0) val = r.readSVarint();
    else if (field === 7 && wire === 0) val = r.readVarint() !== 0;
    else r.skip(wire);
  }
  return val;
}

function decodePointGeometry(buf, start, end) {
  const r = new PbfReader(buf, start, end);
  let x = 0;
  let y = 0;
  while (r.pos < r.end) {
    const cmdInt = r.readVarint();
    const cmd = cmdInt & 0x7;
    const count = cmdInt >>> 3;
    if (cmd === 1 && count > 0) {
      x += r.readSVarint();
      y += r.readSVarint();
      return [x, y];
    }
    break;
  }
  return null;
}

function tilePixelToLatLon(z, tx, ty, px, py, extent) {
  const n = Math.pow(2, z);
  const lon = ((tx + px / extent) / n) * 360 - 180;
  const mercY = Math.PI * (1 - (2 * (ty + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(mercY)) * 180) / Math.PI;
  return { lat, lon };
}

function decodeLayer(buf, start, end, z, tx, ty) {
  const r = new PbfReader(buf, start, end);
  let extent = 4096;
  const keys = [];
  const values = [];
  const rawFeatures = [];

  while (r.pos < r.end) {
    const tag = r.readVarint();
    const field = tag >>> 3;
    const wire = tag & 7;

    if (field === 2 && wire === 2) {
      const len = r.readVarint();
      rawFeatures.push([r.pos, r.pos + len]);
      r.pos += len;
    } else if (field === 3 && wire === 2) {
      keys.push(r.readString(r.readVarint()));
    } else if (field === 4 && wire === 2) {
      const len = r.readVarint();
      values.push(decodeValue(buf, r.pos, r.pos + len));
      r.pos += len;
    } else if (field === 5 && wire === 0) {
      extent = r.readVarint() || 4096;
    } else {
      r.skip(wire);
    }
  }

  const points = [];
  for (let i = 0; i < rawFeatures.length; i++) {
    const [fStart, fEnd] = rawFeatures[i];
    const fr = new PbfReader(buf, fStart, fEnd);
    let id = null;
    let geomType = 0;
    let pt = null;
    const props = {};

    while (fr.pos < fr.end) {
      const tag = fr.readVarint();
      const field = tag >>> 3;
      const wire = tag & 7;

      if (field === 1 && wire === 0) {
        id = fr.readVarint();
      } else if (field === 2 && wire === 2) {
        const len = fr.readVarint();
        const tEnd = fr.pos + len;
        while (fr.pos < tEnd) {
          const kIdx = fr.readVarint();
          const vIdx = fr.readVarint();
          const key = keys[kIdx];
          if (key !== undefined) props[key] = values[vIdx];
        }
      } else if (field === 3 && wire === 0) {
        geomType = fr.readVarint();
      } else if (field === 4 && wire === 2) {
        const len = fr.readVarint();
        pt = decodePointGeometry(buf, fr.pos, fr.pos + len);
        fr.pos += len;
      } else {
        fr.skip(wire);
      }
    }

    if (geomType === 1 && pt) {
      const { lat, lon } = tilePixelToLatLon(z, tx, ty, pt[0], pt[1], extent);
      points.push({ id, lat, lon, properties: props });
    }
  }

  return points;
}

/**
 * Decode an MVT protobuf binary tile at slippy coordinates (z, tx, ty).
 * @param {Uint8Array|ArrayBuffer} input
 * @param {number} z
 * @param {number} tx
 * @param {number} ty
 * @returns {Array<{id: number|null, lat: number, lon: number, properties: Record<string, any>}>}
 */
export function decodeMvtPoints(input, z, tx, ty) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length === 0) return [];

  const r = new PbfReader(buf, 0, buf.length);
  const allPoints = [];

  while (r.pos < r.end) {
    const tag = r.readVarint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      const len = r.readVarint();
      const pts = decodeLayer(buf, r.pos, r.pos + len, z, tx, ty);
      for (let i = 0; i < pts.length; i++) allPoints.push(pts[i]);
      r.pos += len;
    } else {
      r.skip(wire);
    }
  }

  return allPoints;
}
