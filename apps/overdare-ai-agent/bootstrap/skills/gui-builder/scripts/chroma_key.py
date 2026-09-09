# @summary Removes a flat green/blue key background from generated artwork and saves a separate RGBA PNG.
import argparse
import json
from pathlib import Path

try:
    from PIL import Image
except ImportError as error:
    raise SystemExit("Pillow is required. Use a Python environment with Pillow installed.") from error


KEY_CHANNELS = {"green": 1, "blue": 2}


def key_pixel(pixel, key="green", tolerance=32):
    """Remove key-colored pixels and unmix keyed antialiasing at the edge."""
    channel = KEY_CHANNELS[key]
    rgb, original_alpha = pixel[:3], pixel[3]
    background = tuple(255 if i == channel else 0 for i in range(3))
    if original_alpha == 0 or max(abs(c - k) for c, k in zip(rgb, background)) <= tolerance:
        return (0, 0, 0, 0)
    excess = rgb[channel] - max(rgb[i] for i in range(3) if i != channel)
    if excess <= tolerance:
        return pixel
    coverage = 1 - excess / 255
    alpha = round(original_alpha * coverage)
    if alpha == 0:
        return (0, 0, 0, 0)
    foreground = tuple(
        max(0, min(255, round((c - (1 - coverage) * k) / coverage)))
        for c, k in zip(rgb, background)
    )
    return (*foreground, alpha)


def remove_background(source, target, key="green", tolerance=32):
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve():
        raise ValueError("Use a separate output path; the source must be preserved.")
    if target.exists():
        raise FileExistsError(f"Output already exists: {target}")
    if target.suffix.lower() != ".png":
        raise ValueError("Output must be a PNG file.")
    if key not in KEY_CHANNELS or not 0 <= tolerance < 255:
        raise ValueError("Use green or blue and a tolerance between 0 and 254.")

    with Image.open(source) as image:
        rgba = image.convert("RGBA")
    source_pixels = rgba.load()
    original = [source_pixels[x, y] for y in range(rgba.height) for x in range(rgba.width)]
    pixels = [key_pixel(pixel, key, tolerance) for pixel in original]
    removed = sum(before[3] > 0 and after[3] == 0 for before, after in zip(original, pixels))
    if removed == 0:
        raise ValueError("No opaque key background was removed; check the image and key color.")
    if not any(pixel[3] > 0 for pixel in pixels):
        raise ValueError("No foreground remains; use a key color absent from the artwork.")

    result = Image.new("RGBA", rgba.size)
    result.putdata(pixels)
    # Exclusive creation protects existing assets, including concurrent outputs.
    with target.open("xb") as output:
        try:
            result.save(output, format="PNG")
        except Exception:
            output.close()
            target.unlink()
            raise
    return {
        "file": str(target.resolve()),
        "width": result.width,
        "height": result.height,
        "key": key,
        "transparent_pixels": sum(pixel[3] == 0 for pixel in pixels),
        "partial_alpha_pixels": sum(0 < pixel[3] < 255 for pixel in pixels),
        "removed_pixels": removed,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__ or "Remove a flat chroma-key background.")
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--key", choices=KEY_CHANNELS, default="green")
    parser.add_argument("--tolerance", type=int, default=32)
    args = parser.parse_args()
    try:
        print(json.dumps(remove_background(args.source, args.target, args.key, args.tolerance)))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
