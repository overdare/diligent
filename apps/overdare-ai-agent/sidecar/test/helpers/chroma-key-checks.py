# @summary Pixel-level assertions run by the chroma-key CLI integration test.
import importlib.util
from pathlib import Path
import tempfile
import unittest

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[3] / "bootstrap/skills/gui-builder/scripts/chroma_key.py"
spec = importlib.util.spec_from_file_location("chroma_key", SCRIPT)
chroma_key = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chroma_key)


class ChromaKeyTest(unittest.TestCase):
    def test_removes_key_and_preserves_cyan_white_and_dark_art(self):
        self.assertEqual(chroma_key.key_pixel((0, 255, 0, 255)), (0, 0, 0, 0))
        self.assertEqual(chroma_key.key_pixel((5, 239, 3, 255)), (0, 0, 0, 0))
        for pixel in [(0, 220, 255, 255), (255, 255, 255, 255), (12, 25, 40, 255)]:
            self.assertEqual(chroma_key.key_pixel(pixel), pixel)

    def test_unmixes_green_at_antialiased_white_and_black_edges(self):
        self.assertEqual(chroma_key.key_pixel((128, 255, 128, 255)), (255, 255, 255, 128))
        self.assertEqual(chroma_key.key_pixel((0, 128, 0, 255)), (0, 0, 0, 127))

    def test_preserves_existing_alpha(self):
        self.assertEqual(chroma_key.key_pixel((12, 25, 40, 80)), (12, 25, 40, 80))
        self.assertEqual(chroma_key.key_pixel((128, 255, 128, 128)), (255, 255, 255, 64))

    def test_blue_key_preserves_green_art(self):
        self.assertEqual(chroma_key.key_pixel((0, 0, 255, 255), "blue"), (0, 0, 0, 0))
        self.assertEqual(chroma_key.key_pixel((0, 255, 0, 255), "blue"), (0, 255, 0, 255))

    def test_writes_rgba_preserving_dimensions_and_input(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / "source.png", Path(directory) / "alpha.png"
            image = Image.new("RGB", (5, 5), (0, 255, 0))
            image.putpixel((2, 2), (20, 30, 40))
            image.save(source)
            original = source.read_bytes()
            result = chroma_key.remove_background(source, target)
            with Image.open(target) as output:
                self.assertEqual(output.mode, "RGBA")
                self.assertEqual(output.size, (5, 5))
                self.assertEqual(output.getpixel((0, 0)), (0, 0, 0, 0))
                self.assertEqual(output.getpixel((2, 2)), (20, 30, 40, 255))
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(result["transparent_pixels"], 24)

    def test_refuses_overwrite_and_same_path(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / "source.png", Path(directory) / "alpha.png"
            image = Image.new("RGB", (5, 5), (0, 255, 0))
            image.putpixel((2, 2), (20, 30, 40))
            image.save(source)
            target.write_bytes(b"existing")
            with self.assertRaises(ValueError):
                chroma_key.remove_background(source, source)
            with self.assertRaises(FileExistsError):
                chroma_key.remove_background(source, target)
            self.assertEqual(target.read_bytes(), b"existing")

    def test_rejects_non_keyed_and_empty_foreground_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / "source.png", Path(directory) / "alpha.png"
            for color in [(15, 25, 40), (0, 255, 0)]:
                Image.new("RGB", (5, 5), color).save(source)
                with self.assertRaises(ValueError):
                    chroma_key.remove_background(source, target)
                self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
