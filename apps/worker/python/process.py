#!/usr/bin/env python3
"""
ChromaCraft Enhanced Post-Processing Module.
Background removal, identity-preserving resize, high-quality PNG export.
Supports multiple processing modes: remove-bg, resize-only, mask-extract, identity-crop.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from io import BytesIO
from typing import Optional

from PIL import Image, ImageFilter
from rembg import remove as remove_bg
from identity import create_segmentation_mask, identity_lock_composite

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("chromacraft-process")

TARGET_SIZE = (800, 600)
HIGH_RES_SIZE = (2048, 1536)
RAW_FILE_PATTERN = re.compile(r"^raw_(.+)\.png$", re.IGNORECASE)


def color_slug_from_raw_filename(filename: str) -> Optional[str]:
    match = RAW_FILE_PATTERN.match(filename)
    return match.group(1) if match else None


def process_image_enhanced(
    input_path: str,
    output_path: str,
    target_size: tuple = TARGET_SIZE,
    remove_bg_flag: bool = True,
    smooth_mask: bool = True,
    ref_image_path: Optional[str] = None,
    identity_lock: bool = True,
) -> None:
    """
    Enhanced image processing with:
    - Background removal (U2-Net)
    - Alpha matte refinement
    - Identity lock (optional)
    - High-quality LANCZOS resize
    """
    with open(input_path, "rb") as f:
        input_data = f.read()

    # Background removal
    if remove_bg_flag:
        output_data = remove_bg(
            input_data,
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=10,
        )
        img = Image.open(BytesIO(output_data)).convert("RGBA")
    else:
        img = Image.open(BytesIO(input_data)).convert("RGBA")

    # Smooth mask edges
    if smooth_mask and remove_bg_flag:
        alpha = img.split()[-1]
        alpha = alpha.filter(ImageFilter.SMOOTH_MORE)
        alpha = alpha.filter(ImageFilter.SMOOTH_MORE)
        img.putalpha(alpha)

    # Identity lock: force original product structure
    if identity_lock and ref_image_path and os.path.isfile(ref_image_path):
        mask = create_segmentation_mask(ref_image_path)
        locked_path = output_path + ".locked.png"
        identity_lock_composite(ref_image_path, input_path, mask, locked_path, blur_radius=2)
        if os.path.exists(locked_path):
            locked_img = Image.open(locked_path).convert("RGBA")
            locked_img = locked_img.resize(target_size, Image.Resampling.LANCZOS)
            locked_img.save(output_path, "PNG")
            os.remove(locked_path)
            logger.info("Saved identity-locked processed image: %s", output_path)
            return

    # Resize
    img = img.resize(target_size, Image.Resampling.LANCZOS)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    img.save(output_path, "PNG")
    logger.info("Saved processed image: %s", output_path)


def extract_mask(input_path: str, output_path: str) -> None:
    """Extract and save the alpha mask from an image."""
    img = Image.open(input_path).convert("RGBA")
    alpha = img.split()[-1]
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    alpha.save(output_path, "PNG")
    logger.info("Saved mask: %s", output_path)


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Enhanced Post-Processing Worker")
    p.add_argument("--inputDir", required=True, help="Directory containing raw_{color}.png files")
    p.add_argument("--outputDir", required=True, help="Directory for processed PNG output")
    p.add_argument("--prefix", required=True, help="Filename prefix (e.g. Mitsubishi_ASX)")
    p.add_argument("--refImage", default=None, help="Reference image for identity lock")
    p.add_argument("--task", choices=["process", "mask"], default="process")
    p.add_argument("--highRes", action="store_true", help="Output at 2048x1536 instead of 800x600")
    p.add_argument("--noBackgroundRemoval", action="store_true", help="Skip background removal")
    p.add_argument("--noIdentityLock", action="store_true", help="Skip identity lock")
    p.add_argument("--jsonMode", action="store_true", help="Output JSON for orchestrator consumption")
    return p


def main() -> int:
    args = build_parser().parse_args()

    if not os.path.isdir(args.inputDir):
        logger.error("Input directory does not exist: %s", args.inputDir)
        return 1

    os.makedirs(args.outputDir, exist_ok=True)

    entries = sorted(os.listdir(args.inputDir))

    if args.task == "mask":
        # Extract masks for all PNGs
        png_files = [f for f in entries if f.endswith(".png")]
        for filename in png_files:
            input_path = os.path.join(args.inputDir, filename)
            out_name = f"mask_{filename}"
            output_path = os.path.join(args.outputDir, out_name)
            try:
                extract_mask(input_path, output_path)
            except Exception as exc:
                logger.error("Failed to extract mask for %s: %s", filename, exc)
        return 0

    raw_files = [f for f in entries if RAW_FILE_PATTERN.match(f)]
    if not raw_files:
        logger.error("No raw_{color}.png files found in %s", args.inputDir)
        return 1

    size = HIGH_RES_SIZE if args.highRes else TARGET_SIZE
    failures = 0
    results = []

    for filename in raw_files:
        color_slug = color_slug_from_raw_filename(filename)
        if not color_slug:
            logger.warning("Skipping unrecognized file: %s", filename)
            continue

        input_path = os.path.join(args.inputDir, filename)
        output_path = os.path.join(args.outputDir, f"{args.prefix}_{color_slug}.png")

        try:
            process_image_enhanced(
                input_path=input_path,
                output_path=output_path,
                target_size=size,
                remove_bg_flag=not args.noBackgroundRemoval,
                ref_image_path=args.refImage or None,
                identity_lock=not args.noIdentityLock,
            )
            results.append({"input": filename, "output": output_path, "status": "done"})
        except Exception as exc:
            failures += 1
            results.append({"input": filename, "output": None, "status": "error", "error": str(exc)})
            logger.error("Failed to process %s: %s", filename, exc)

    if args.jsonMode:
        print(json.dumps({
            "status": "success" if failures == 0 else "partial",
            "total": len(raw_files),
            "success": len(raw_files) - failures,
            "failures": failures,
            "results": results,
        }), flush=True)

    if failures:
        logger.error("Completed with %d failure(s) out of %d file(s)", failures, len(raw_files))
        return 1

    logger.info("Successfully processed all %d image(s)", len(raw_files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
