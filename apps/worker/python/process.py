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
    preserve_resolution: bool = True,
) -> None:
    """
    Enhanced image processing with:
    - Background removal (U2-Net)
    - Alpha matte refinement
    - Identity lock (LAB-space, preserves generated color)
    - Optional resize (disabled by default — preserves original AI resolution)
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

    # Only resize if requested and different from input size
    if not preserve_resolution and target_size and target_size != img.size:
        img = img.resize(target_size, Image.Resampling.LANCZOS)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    img.save(output_path, "PNG")

    # Identity lock: force original product structure (luminance) but preserve generated color
    if identity_lock and ref_image_path and os.path.isfile(ref_image_path):
        mask = create_segmentation_mask(ref_image_path)
        locked_path = output_path + ".locked.png"
        identity_lock_composite(ref_image_path, output_path, mask, locked_path, blur_radius=2)
        if os.path.exists(locked_path):
            os.replace(locked_path, output_path)
            logger.info("Saved identity-locked processed image: %s (%dx%d)", output_path, img.width, img.height)
            return

    logger.info("Saved processed image: %s (%dx%d)", output_path, img.width, img.height)


def extract_mask(input_path: str, output_path: str) -> None:
    """Extract and save the alpha mask from an image."""
    img = Image.open(input_path).convert("RGBA")
    alpha = img.split()[-1]
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    alpha.save(output_path, "PNG")
    logger.info("Saved mask: %s", output_path)


def create_social_crops(image_path: str, output_dir: str, prefix: str, color_slug: str) -> None:
    img = Image.open(image_path)
    w, h = img.size
    
    # 1. Instagram 1:1 crop
    sq_size = min(w, h)
    left = (w - sq_size) // 2
    top = (h - sq_size) // 2
    right = left + sq_size
    bottom = top + sq_size
    img_1_1 = img.crop((left, top, right, bottom))
    img_1_1.save(os.path.join(output_dir, f"{prefix}_{color_slug}_instagram.png"), "PNG")
    logger.info("Saved Instagram crop: %s", os.path.join(output_dir, f"{prefix}_{color_slug}_instagram.png"))
    
    # 2. X/Blog 16:9 crop
    target_aspect = 16.0 / 9.0
    current_aspect = w / h
    if current_aspect > target_aspect:
        new_w = int(h * target_aspect)
        left = (w - new_w) // 2
        right = left + new_w
        crop_box = (left, 0, right, h)
    else:
        new_h = int(w / target_aspect)
        top = (h - new_h) // 2
        bottom = top + new_h
        crop_box = (0, top, w, bottom)
    img_16_9 = img.crop(crop_box)
    img_16_9.save(os.path.join(output_dir, f"{prefix}_{color_slug}_banner.png"), "PNG")
    logger.info("Saved X/Blog banner crop: %s", os.path.join(output_dir, f"{prefix}_{color_slug}_banner.png"))

    # 3. Stories 9:16 crop
    target_aspect_vert = 9.0 / 16.0
    if current_aspect > target_aspect_vert:
        new_w = int(h * target_aspect_vert)
        left = (w - new_w) // 2
        right = left + new_w
        crop_box = (left, 0, right, h)
    else:
        new_h = int(w / target_aspect_vert)
        top = (h - new_h) // 2
        bottom = top + new_h
        crop_box = (0, top, w, bottom)
    img_9_16 = img.crop(crop_box)
    img_9_16.save(os.path.join(output_dir, f"{prefix}_{color_slug}_story.png"), "PNG")
    logger.info("Saved Story crop: %s", os.path.join(output_dir, f"{prefix}_{color_slug}_story.png"))


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
    p.add_argument("--socialCrops", action="store_true", help="Generate social media crops (1:1, 16:9, 9:16)")
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
                preserve_resolution=True,
                remove_bg_flag=not args.noBackgroundRemoval,
                ref_image_path=args.refImage or None,
                identity_lock=not args.noIdentityLock,
            )
            results.append({"input": filename, "output": output_path, "status": "done"})
            
            if args.socialCrops:
                create_social_crops(output_path, args.outputDir, args.prefix, color_slug)
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
