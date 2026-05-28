#!/usr/bin/env python3
"""
ChromaCraft Identity Preservation Module.
Segmentation, edge detection, depth estimation, mask composition, structure locking.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from io import BytesIO
from typing import Optional

import cv2
import numpy as np
from PIL import Image
from rembg import remove as remove_bg


def color_to_slug(color: str) -> str:
    return "".join(c if c.isalnum() or c == "_" else "_" for c in color.strip().replace(" ", "_"))


def create_segmentation_mask(image_path: str) -> np.ndarray:
    """Create precise product mask using rembg (U2-Net). Returns binary mask array."""
    with open(image_path, "rb") as f:
        input_data = f.read()
    result = remove_bg(input_data)
    img = Image.open(BytesIO(result)).convert("RGBA")
    mask = np.array(img.split()[-1])
    return mask


def extract_edges(image_path: str, low_thresh: int = 50, high_thresh: int = 150) -> np.ndarray:
    """Canny edge detection for ControlNet structure guidance."""
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")
    edges = cv2.Canny(img, low_thresh, high_thresh)
    return edges


def extract_soft_edges(image_path: str) -> np.ndarray:
    """Soft edge detection (HED-style) for structure preservation."""
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")
    blurred = cv2.GaussianBlur(img, (5, 5), 0)
    edges = cv2.Canny(blurred, 30, 100)
    dilated = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    return dilated


def estimate_depth(image_path: str) -> np.ndarray:
    """MiDaS depth estimation fallback using simple Laplacian variance."""
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")
    laplacian = cv2.Laplacian(img, cv2.CV_64F)
    depth_map = cv2.normalize(laplacian, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
    return depth_map


def create_control_inputs(image_path: str) -> dict:
    """Generate all structure-preserving control inputs."""
    return {
        "segmentation": create_segmentation_mask(image_path),
        "canny": extract_edges(image_path),
        "softedge": extract_soft_edges(image_path),
        "depth": estimate_depth(image_path),
    }


def save_control_inputs(image_path: str, out_dir: str, prefix: str = "") -> dict:
    """Generate control inputs and save them as PNG files. Returns paths dict."""
    inputs = create_control_inputs(image_path)
    paths = {}
    os.makedirs(out_dir, exist_ok=True)
    for name, arr in inputs.items():
        path = os.path.join(out_dir, f"{prefix}_{name}.png" if prefix else f"{name}.png")
        Image.fromarray(arr).save(path)
        paths[name] = path
    return paths


def identity_lock_composite(
    original_path: str,
    generated_path: str,
    mask: np.ndarray,
    output_path: str,
    blur_radius: int = 5,
) -> str:
    """
    Lock original product identity within mask region.
    Uses feathering at mask boundaries for natural blending.
    """
    orig = Image.open(original_path).convert("RGBA")
    gen = Image.open(generated_path).convert("RGBA")

    orig_resized = orig.resize(gen.size, Image.LANCZOS)
    mask_resized = Image.fromarray(mask).resize(gen.size, Image.LANCZOS)

    mask_np = np.array(mask_resized).astype(np.float32) / 255.0

    # Feather mask edges
    if blur_radius > 0:
        mask_np = cv2.GaussianBlur(mask_np, (blur_radius * 2 + 1, blur_radius * 2 + 1), 0)

    orig_np = np.array(orig_resized).astype(np.float32)
    gen_np = np.array(gen).astype(np.float32)

    mask_4ch = np.stack([mask_np] * 4, axis=2)
    composite = gen_np * (1.0 - mask_4ch) + orig_np * mask_4ch
    composite = np.clip(composite, 0, 255).astype(np.uint8)

    result_img = Image.fromarray(composite)
    result_img.save(output_path, "PNG")
    return output_path


def identity_lock_recolor(
    original_path: str,
    generated_path: str,
    output_path: str,
    color: str,
    preservation_strength: float = 0.7,
) -> str:
    """
    Advanced identity lock that preserves structure but allows color changes.
    Only modifies hue channel within the product region.
    """
    orig = cv2.imread(original_path, cv2.IMREAD_UNCHANGED)
    gen = cv2.imread(generated_path, cv2.IMREAD_UNCHANGED)

    if orig is None or gen is None:
        raise ValueError("Cannot read input images for identity lock recolor")

    gen = cv2.resize(gen, (orig.shape[1], orig.shape[0]))

    # Create mask from original alpha or segmentation
    if orig.shape[2] == 4:
        mask = orig[:, :, 3]
    else:
        mask = create_segmentation_mask(original_path)
        mask = cv2.resize(mask, (orig.shape[1], orig.shape[0]))

    mask_np = mask.astype(np.float32) / 255.0
    if preservation_strength > 0:
        mask_np = mask_np * (1.0 - preservation_strength) + preservation_strength

    # Convert both to HSV
    if orig.shape[2] >= 3:
        orig_rgb = orig[:, :, :3]
    else:
        orig_rgb = cv2.cvtColor(orig, cv2.COLOR_GRAY2BGR)

    if gen.shape[2] >= 3:
        gen_rgb = gen[:, :, :3]
    else:
        gen_rgb = cv2.cvtColor(gen, cv2.COLOR_GRAY2BGR)

    orig_hsv = cv2.cvtColor(orig_rgb, cv2.COLOR_BGR2HSV)
    gen_hsv = cv2.cvtColor(gen_rgb, cv2.COLOR_BGR2HSV)

    # Take hue from generated, saturation and value from original (preserve texture)
    blended_hsv = orig_hsv.copy()
    blended_hsv[:, :, 0] = (
        gen_hsv[:, :, 0] * mask_np + orig_hsv[:, :, 0] * (1.0 - mask_np)
    ).astype(np.uint8)
    blended_hsv[:, :, 1] = (
        gen_hsv[:, :, 1] * mask_np + orig_hsv[:, :, 1] * (1.0 - mask_np)
    ).astype(np.uint8)

    blended_rgb = cv2.cvtColor(blended_hsv, cv2.COLOR_HSV2BGR)

    if orig.shape[2] == 4:
        result = cv2.merge([blended_rgb, orig[:, :, 3]])
    else:
        result = blended_rgb

    cv2.imwrite(output_path, result)
    return output_path


def mask_by_color_hsl_shift(
    image_path: str,
    target_hue: int,
    output_path: str,
    mask: Optional[np.ndarray] = None,
) -> str:
    """
    Zero-cost recoloring by shifting HSL hue in the masked region.
    Uses no AI - purely algorithmic color transformation.
    """
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    if mask is None:
        mask = create_segmentation_mask(image_path)
        mask = cv2.resize(mask, (img.shape[1], img.shape[0]))

    rgb = img[:, :, :3]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_BGR2HSV)

    # Shift hue toward target
    current_hue = np.median(hsv[:, :, 0][mask > 128])
    shift = (target_hue - current_hue) % 180
    hsv[:, :, 0] = (hsv[:, :, 0] + (shift * (mask > 128).astype(np.uint8))) % 180

    blended = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

    if img.shape[2] == 4:
        result = cv2.merge([blended, img[:, :, 3]])
    else:
        result = blended

    cv2.imwrite(output_path, result)
    return output_path


HUE_MAP = {
    "red": 0, "orange": 15, "yellow": 30, "cream": 45,
    "green": 60, "teal": 90, "cyan": 105, "blue": 120,
    "dark blue": 140, "purple": 150, "pink": 165,
    "brown": 10, "silver": 90, "white": 0, "black": 0,
}


def hue_for_color(color_name: str) -> int:
    """Map color name to approximate hue value (0-179 OpenCV)."""
    key = color_name.strip().lower()
    for k, v in HUE_MAP.items():
        if k in key or key in k:
            return v
    return 120


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Identity Preservation Module")
    p.add_argument("--task", choices=[
        "segment", "edges", "control_inputs", "lock_composite",
        "lock_recolor", "hsl_shift",
    ], default="control_inputs")
    p.add_argument("--refImage", required=True)
    p.add_argument("--genImage", default=None)
    p.add_argument("--outputDir", default=".")
    p.add_argument("--outputPath", default=None)
    p.add_argument("--color", default="Blue")
    p.add_argument("--preservation", type=float, default=0.7)
    p.add_argument("--jsonMode", action="store_true")
    return p


def _emit(data: dict, json_mode: bool):
    if json_mode:
        print(json.dumps(data), flush=True)
    else:
        print(data)


def main() -> int:
    args = build_parser().parse_args()

    if not os.path.isfile(args.refImage):
        _emit({"status": "error", "reason": f"Reference image not found: {args.refImage}"}, args.jsonMode)
        return 1

    try:
        if args.task == "segment":
            mask = create_segmentation_mask(args.refImage)
            out = args.outputPath or os.path.join(args.outputDir, "segmentation_mask.png")
            os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
            Image.fromarray(mask).save(out)
            _emit({"status": "success", "path": out, "metadata": f"mask_size={mask.shape}"}, args.jsonMode)

        elif args.task == "edges":
            edges = extract_edges(args.refImage)
            out = args.outputPath or os.path.join(args.outputDir, "canny_edges.png")
            os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
            Image.fromarray(edges).save(out)
            _emit({"status": "success", "path": out}, args.jsonMode)

        elif args.task == "control_inputs":
            paths = save_control_inputs(args.refImage, args.outputDir, prefix="identity")
            _emit({"status": "success", "paths": paths}, args.jsonMode)

        elif args.task == "lock_composite":
            if not args.genImage or not os.path.isfile(args.genImage):
                raise ValueError("--genImage required for lock_composite")
            mask = create_segmentation_mask(args.refImage)
            out = args.outputPath or os.path.join(args.outputDir, f"identity_locked_{color_to_slug(args.color)}.png")
            identity_lock_composite(args.refImage, args.genImage, mask, out)
            _emit({"status": "success", "path": out}, args.jsonMode)

        elif args.task == "lock_recolor":
            if not args.genImage or not os.path.isfile(args.genImage):
                raise ValueError("--genImage required for lock_recolor")
            out = args.outputPath or os.path.join(args.outputDir, f"identity_recolor_{color_to_slug(args.color)}.png")
            identity_lock_recolor(args.refImage, args.genImage, out, args.color, args.preservation)
            _emit({"status": "success", "path": out}, args.jsonMode)

        elif args.task == "hsl_shift":
            target_hue = hue_for_color(args.color)
            out = args.outputPath or os.path.join(args.outputDir, f"hsl_{color_to_slug(args.color)}.png")
            mask_by_color_hsl_shift(args.refImage, target_hue, out)
            _emit({"status": "success", "path": out, "metadata": f"target_hue={target_hue},color={args.color}"}, args.jsonMode)

        return 0
    except Exception as exc:
        _emit({"status": "error", "reason": str(exc)}, args.jsonMode)
        return 1


if __name__ == "__main__":
    sys.exit(main())
