#!/usr/bin/env python3
"""UC1 post-processing: background removal, resize, and catalog naming."""

import argparse
import logging
import os
import re
import sys
from io import BytesIO
from typing import Optional

from PIL import Image
from rembg import remove

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("chromacraft-process")

TARGET_SIZE = (800, 600)
RAW_FILE_PATTERN = re.compile(r"^raw_(.+)\.png$", re.IGNORECASE)


def color_slug_from_raw_filename(filename: str) -> Optional[str]:
    """Extract color slug from raw_{color}.png."""
    match = RAW_FILE_PATTERN.match(filename)
    return match.group(1) if match else None


def process_image(input_path: str, output_path: str) -> None:
    """Remove background with rembg, resize to 800x600, save transparent PNG."""
    with open(input_path, "rb") as f:
        input_data = f.read()

    output_data = remove(input_data)
    img = Image.open(BytesIO(output_data)).convert("RGBA")
    img = img.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    img.save(output_path, "PNG")
    logger.info("Saved processed image: %s", output_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="ChromaCraft UC1 Post-Processing Worker")
    parser.add_argument("--inputDir", required=True, help="Directory containing raw_{color}.png files")
    parser.add_argument("--outputDir", required=True, help="Directory for final {prefix}_{color}.png files")
    parser.add_argument("--prefix", required=True, help="Filename prefix (e.g. Mitsubishi_ASX)")
    args = parser.parse_args()

    if not os.path.isdir(args.inputDir):
        logger.error("Input directory does not exist: %s", args.inputDir)
        return 1

    os.makedirs(args.outputDir, exist_ok=True)

    entries = sorted(os.listdir(args.inputDir))
    raw_files = [f for f in entries if RAW_FILE_PATTERN.match(f)]

    if not raw_files:
        logger.error("No raw_{color}.png files found in %s", args.inputDir)
        return 1

    logger.info(
        "Processing %d file(s) from %s -> %s (prefix=%s)",
        len(raw_files),
        args.inputDir,
        args.outputDir,
        args.prefix,
    )

    failures = 0
    for filename in raw_files:
        color_slug = color_slug_from_raw_filename(filename)
        if not color_slug:
            logger.warning("Skipping unrecognized file: %s", filename)
            continue

        input_path = os.path.join(args.inputDir, filename)
        output_path = os.path.join(args.outputDir, f"{args.prefix}_{color_slug}.png")

        try:
            process_image(input_path, output_path)
        except Exception as exc:
            failures += 1
            logger.error("Failed to process %s: %s", filename, exc, exc_info=True)

    if failures:
        logger.error("Completed with %d failure(s) out of %d file(s)", failures, len(raw_files))
        return 1

    logger.info("Successfully processed all %d image(s)", len(raw_files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
