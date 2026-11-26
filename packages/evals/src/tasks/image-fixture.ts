// @summary Deterministic in-memory PNG fixtures and a pixel probe shared by image transport and generation evals

import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

export type EvalImageColor = "RED" | "BLUE";

export function seededImagePair(seed: string): { a: EvalImageColor; b: EvalImageColor } {
  return createHash("sha256").update(seed).digest()[0]! % 2 === 1 ? { a: "BLUE", b: "RED" } : { a: "RED", b: "BLUE" };
}

export function solidColorPng(color: EvalImageColor): Buffer {
  const [red, green, blue] = color === "RED" ? [220, 30, 30] : [30, 30, 220];
  const width = 64;
  const height = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Array.from({ length: height }, () => {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = red;
      row[2 + x * 3] = green;
      row[3 + x * 3] = blue;
    }
    return row;
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Reads the only pixel of a 1x1, 8-bit RGB or RGBA PNG. Every PNG row filter reconstructs a single
 * pixel to its stored bytes because the left and upper neighbors are zero.
 */
export function singlePixelPngRgb(png: Uint8Array): readonly [number, number, number] {
  const bytes = Buffer.from(png);
  if (bytes.length < 33 || bytes.readUInt32BE(16) !== 1 || bytes.readUInt32BE(20) !== 1 || bytes[24] !== 8) {
    throw new Error("Expected a 1x1 8-bit PNG.");
  }
  const colorType = bytes[25];
  if (colorType !== 2 && colorType !== 6) throw new Error(`Unsupported PNG color type ${colorType}.`);
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const row = inflateSync(Buffer.concat(idat));
  if (row.length < 4) throw new Error("PNG pixel data is truncated.");
  return [row[1]!, row[2]!, row[3]!];
}

export function solidColorImageBlock(color: EvalImageColor) {
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/png" as const,
      data: solidColorPng(color).toString("base64"),
    },
  };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
