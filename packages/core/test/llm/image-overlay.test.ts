// @summary Tests for compositing normalized RGBA rectangles onto images without layering overlaps.
import { beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error -- file import yields a path string at runtime
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm" with { type: "file" };
import decodePng, { init as initPngDecode } from "@jsquash/png/decode";
import encodePng, { init as initPngEncode } from "@jsquash/png/encode";
import { compositeImageRects, type NormalizedImageRect } from "../../src/contracts/image";

function image(width: number, height: number, rgba: readonly [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set(rgba, index);
  return { data, width, height } as ImageData;
}

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return [...data.slice(offset, offset + 4)];
}

let opaquePng: ArrayBuffer;

beforeAll(async () => {
  const module = await WebAssembly.compile(await Bun.file(pngWasm).arrayBuffer());
  await initPngDecode(module);
  await initPngEncode(module);
  opaquePng = await encodePng(image(4, 4, [10, 20, 30, 255]));
});

describe("compositeImageRects", () => {
  test("composites a normalized rect while leaving pixels outside it unchanged", async () => {
    const result = await compositeImageRects(
      opaquePng,
      "image/png",
      [{ left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 }],
      [255, 0, 0, 128],
    );
    const decoded = await decodePng(result.bytes);

    expect(result).toMatchObject({ mediaType: "image/png", width: 4, height: 4 });
    expect(pixel(decoded.data, 4, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(pixel(decoded.data, 4, 1, 1)).toEqual([133, 10, 15, 255]);
    expect(pixel(decoded.data, 4, 3, 3)).toEqual([10, 20, 30, 255]);
  });

  test("uses source-over alpha compositing for a partially transparent source pixel", async () => {
    const source = await encodePng(image(1, 1, [0, 100, 200, 128]));
    const result = await compositeImageRects(
      source,
      "image/png",
      [{ left: 0, top: 0, right: 1, bottom: 1 }],
      [200, 50, 0, 128],
    );
    const decoded = await decodePng(result.bytes);

    expect(pixel(decoded.data, 1, 0, 0)).toEqual([134, 67, 66, 192]);
  });

  test("tints overlapping rectangles once", async () => {
    const result = await compositeImageRects(
      opaquePng,
      "image/png",
      [
        { left: 0, top: 0, right: 0.75, bottom: 1 },
        { left: 0.25, top: 0, right: 1, bottom: 1 },
      ],
      [0, 0, 0, 128],
    );
    const decoded = await decodePng(result.bytes);

    expect(pixel(decoded.data, 4, 0, 0)).toEqual([5, 10, 15, 255]);
    expect(pixel(decoded.data, 4, 1, 0)).toEqual([5, 10, 15, 255]);
    expect(pixel(decoded.data, 4, 3, 0)).toEqual([5, 10, 15, 255]);
  });

  test("clips normalized rectangles to the image bounds", async () => {
    const result = await compositeImageRects(
      opaquePng,
      "image/png",
      [{ left: -0.25, top: -0.5, right: 0.5, bottom: 0.5 }],
      [255, 0, 0, 255],
    );
    const decoded = await decodePng(result.bytes);

    expect(pixel(decoded.data, 4, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(decoded.data, 4, 2, 1)).toEqual([10, 20, 30, 255]);
    expect(pixel(decoded.data, 4, 1, 2)).toEqual([10, 20, 30, 255]);
  });

  test("ignores invalid rectangles without changing the input buffer", async () => {
    const inputBefore = new Uint8Array(opaquePng).slice();
    const invalid: NormalizedImageRect = { left: Number.NaN, top: 0, right: 1, bottom: 1 };
    const result = await compositeImageRects(
      opaquePng,
      "image/png",
      [invalid, { left: 1, top: 0, right: 0, bottom: 1 }],
      [1, 2, 3, 255],
    );
    const decoded = await decodePng(result.bytes);

    expect(new Uint8Array(opaquePng)).toEqual(inputBefore);
    expect(pixel(decoded.data, 4, 2, 2)).toEqual([10, 20, 30, 255]);
  });

  test("rejects malformed images and invalid overlay colors", async () => {
    await expect(compositeImageRects(new ArrayBuffer(0), "image/png", [], [0, 0, 0, 255])).rejects.toThrow(
      "Invalid or oversized image dimensions.",
    );
    await expect(compositeImageRects(opaquePng, "image/png", [], [0, 0, 0, Number.NaN])).rejects.toThrow(
      "Invalid overlay color.",
    );
  });
});
