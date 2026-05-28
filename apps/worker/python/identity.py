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
import warnings
from io import BytesIO
from typing import Optional

import numpy as np
from PIL import Image, ImageFilter
from rembg import remove as remove_bg

warnings.filterwarnings("ignore")

CV2_AVAILABLE = False
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    pass


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
    img = Image.open(image_path).convert("L")
    img_np = np.array(img)
    if CV2_AVAILABLE:
        img_cv = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if img_cv is None:
            img_cv = img_np
        edges = cv2.Canny(img_cv, low_thresh, high_thresh)
    else:
        from PIL import ImageFilter
        edges_np = np.array(img.filter(ImageFilter.FIND_EDGES))
        _, edges = cv2_threshold(edges_np, 30, 255)
    return edges


def extract_soft_edges(image_path: str) -> np.ndarray:
    """Soft edge detection for structure preservation."""
    img = Image.open(image_path).convert("L")
    if CV2_AVAILABLE:
        img_cv = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
        if img_cv is None:
            img_cv = np.array(img)
        blurred = cv2.GaussianBlur(img_cv, (5, 5), 0)
        edges = cv2.Canny(blurred, 30, 100)
        dilated = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    else:
        from PIL import ImageFilter
        blurred = img.filter(ImageFilter.SMOOTH).filter(ImageFilter.SMOOTH)
        edges_np = np.array(blurred.filter(ImageFilter.FIND_EDGES))
        _, dilated = cv2_threshold(edges_np, 25, 255)
    return dilated


def estimate_depth(image_path: str) -> np.ndarray:
    """Depth estimation using Laplacian variance (no MiDaS dependency)."""
    img = Image.open(image_path).convert("L")
    img_np = np.array(img, dtype=np.float64)
    from PIL import ImageFilter
    lap = np.array(img.filter(ImageFilter.Kernel((3, 3), [0, -1, 0, -1, 4, -1, 0, -1, 0], scale=1)))
    depth = np.clip(np.abs(lap), 0, 255).astype(np.uint8)
    return depth


def cv2_threshold(img: np.ndarray, thresh: int, maxval: int) -> tuple:
    """Simple threshold fallback when opencv unavailable."""
    result = np.where(img > thresh, maxval, 0).astype(np.uint8)
    return (result, result)


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

    # Feather mask edges using PIL
    if blur_radius > 0 and CV2_AVAILABLE:
        mask_np = cv2.GaussianBlur(mask_np, (blur_radius * 2 + 1, blur_radius * 2 + 1), 0)
    elif blur_radius > 0:
        mask_pil = mask_resized.filter(ImageFilter.GaussianBlur(radius=blur_radius))
        mask_np = np.array(mask_pil).astype(np.float32) / 255.0

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
    Uses HSV color space via PIL.
    """
    orig = Image.open(original_path).convert("RGBA")
    gen = Image.open(generated_path).convert("RGBA")

    gen = gen.resize(orig.size, Image.LANCZOS)

    # Create mask from original alpha or segmentation
    orig_np = np.array(orig)
    mask = create_segmentation_mask(original_path)
    mask_pil = Image.fromarray(mask).resize(orig.size, Image.LANCZOS)
    mask_np = np.array(mask_pil).astype(np.float32) / 255.0

    if preservation_strength > 0:
        mask_np = mask_np * (1.0 - preservation_strength) + preservation_strength

    # Convert both to HSV using colorsys (no cv2 dependency)
    import colorsys
    gen_np = np.array(gen).astype(np.float32) / 255.0
    orig_np = orig_np.astype(np.float32) / 255.0

    result = np.zeros_like(orig_np)
    for y in range(orig_np.shape[0]):
        for x in range(orig_np.shape[1]):
            if mask_np[y, x] > 0.01:
                r_o, g_o, b_o = orig_np[y, x, :3]
                r_g, g_g, b_g = gen_np[y, x, :3]
                h_o, s_o, v_o = colorsys.rgb_to_hsv(r_o, g_o, b_o)
                h_g, s_g, v_g = colorsys.rgb_to_hsv(r_g, g_g, b_g)
                # Blend: hue from generated, sat/value from original
                m = mask_np[y, x]
                h = h_g * m + h_o * (1 - m)
                s = s_g * m + s_o * (1 - m)
                v = v_o
                r, g, b = colorsys.hsv_to_rgb(h, s, v)
                result[y, x, :3] = [r, g, b]
                result[y, x, 3] = orig_np[y, x, 3]
            else:
                result[y, x] = orig_np[y, x]

    result = np.clip(result * 255, 0, 255).astype(np.uint8)
    Image.fromarray(result).save(output_path, "PNG")
    return output_path


def mask_by_color_hsl_shift(
    image_path: str,
    target_hue: int,
    output_path: str,
    mask: Optional[np.ndarray] = None,
) -> str:
    """
    Zero-cost recoloring by shifting HSL hue in the masked region.
    Uses PIL + colorsys — no cv2 dependency.
    """
    img = Image.open(image_path).convert("RGBA")
    img_np = np.array(img).astype(np.float32) / 255.0

    if mask is None:
        mask = create_segmentation_mask(image_path)
    mask_pil = Image.fromarray(mask).resize(img.size, Image.LANCZOS)
    mask_np = np.array(mask_pil).astype(np.float32) / 255.0

    import colorsys
    target_hue_norm = target_hue / 180.0  # Normalize to 0-1

    result = np.zeros_like(img_np)
    for y in range(img_np.shape[0]):
        for x in range(img_np.shape[1]):
            if mask_np[y, x] > 0.5:
                r, g, b = img_np[y, x, :3]
                h, s, v = colorsys.rgb_to_hsv(r, g, b)
                # Shift hue toward target within mask
                h = target_hue_norm
                r2, g2, b2 = colorsys.hsv_to_rgb(h, s, v)
                result[y, x, :3] = [r2, g2, b2]
                result[y, x, 3] = img_np[y, x, 3]
            else:
                result[y, x] = img_np[y, x]

    result = np.clip(result * 255, 0, 255).astype(np.uint8)
    Image.fromarray(result).save(output_path, "PNG")
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
