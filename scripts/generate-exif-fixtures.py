#!/usr/bin/env python3
"""
Generate EXIF orientation regression fixtures and the upright reference PNG
from a single in-memory source image, so all fixtures stay consistent.

Outputs (written to e2e/fixtures/exif/):
  - upright-reference.png   200x100 upright reference (quadrant colors)
  - o1.jpg                  EXIF orientation 1 (no rotation)
  - o3.jpg                  EXIF orientation 3 (180)
  - o6.jpg                  EXIF orientation 6 (90 CW when viewed)
  - o8.jpg                  EXIF orientation 8 (90 CCW when viewed)

The stored pixels are pre-rotated to the INVERSE of the display rotation so
that an EXIF-aware decoder renders the upright reference for every file.

Quadrants (upright): TL=red, TR=green, BL=blue, BR=yellow.

Usage:
  python scripts/generate-exif-fixtures.py
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image
import piexif

WIDTH, HEIGHT = 200, 100
OUT_DIR = Path(__file__).resolve().parent.parent / "e2e" / "fixtures" / "exif"

# Upright quadrant colors — must match e2e/image-orientation.spec.ts EXPECTED.
QUADRANTS = {
    "tl": (255, 0, 0),
    "tr": (0, 255, 0),
    "bl": (0, 0, 255),
    "br": (255, 255, 0),
}

# EXIF orientation -> inverse rotation applied to stored pixels so that an
# orientation-aware viewer renders the upright reference.
# (PIL rotate() is counter-clockwise.)
STORED_ROTATION = {
    1: 0,     # no rotation
    3: 180,   # display 180 -> store rotated 180
    6: 270,   # display 90 CW -> store rotated 90 CW (== -90 == 270 CCW)
    8: 90,    # display 90 CCW -> store rotated 90 CCW
}


def build_upright() -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    hw, hh = WIDTH // 2, HEIGHT // 2
    px = img.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if x < hw and y < hh:
                px[x, y] = QUADRANTS["tl"]
            elif x >= hw and y < hh:
                px[x, y] = QUADRANTS["tr"]
            elif x < hw and y >= hh:
                px[x, y] = QUADRANTS["bl"]
            else:
                px[x, y] = QUADRANTS["br"]
    return img


def write_jpeg(upright: Image.Image, orientation: int, path: Path) -> None:
    rot = STORED_ROTATION[orientation]
    # expand=True so 90/270 swap the stored dimensions, which is what real
    # cameras do (portrait sensor rows stored, EXIF says "rotate to view").
    stored = upright.rotate(rot, expand=True) if rot else upright.copy()
    exif = {"0th": {piexif.ImageIFD.Orientation: orientation}}
    exif_bytes = piexif.dump(exif)
    buf = io.BytesIO()
    stored.save(buf, format="JPEG", quality=92, exif=exif_bytes)
    path.write_bytes(buf.getvalue())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    upright = build_upright()

    ref_path = OUT_DIR / "upright-reference.png"
    upright.save(ref_path, format="PNG", optimize=True)
    print(f"wrote {ref_path.relative_to(OUT_DIR.parent.parent.parent)}")

    for orientation in (1, 3, 6, 8):
        jpg_path = OUT_DIR / f"o{orientation}.jpg"
        write_jpeg(upright, orientation, jpg_path)
        print(f"wrote {jpg_path.relative_to(OUT_DIR.parent.parent.parent)} (orientation={orientation})")


if __name__ == "__main__":
    main()
