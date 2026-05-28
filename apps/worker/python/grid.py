#!/usr/bin/env python3
"""
ChromaCraft Professional Grid Collage Generator.
Flexible grid layouts with spacing, labels, aspect-ratio handling, and high-res export.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from math import ceil
from typing import Optional

from PIL import Image, ImageDraw, ImageFont


GRID_LAYOUTS = {
    "2x2": {"cols": 2, "rows": 2},
    "2x3": {"cols": 2, "rows": 3},
    "4x4": {"cols": 4, "rows": 4},
    "1x3": {"cols": 1, "rows": 3},
    "3x1": {"cols": 3, "rows": 1},
    "3x3": {"cols": 3, "rows": 3},
    "1x1": {"cols": 1, "rows": 1},
}


def slugify(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", text.strip().replace(" ", "_"))


def generate_grid(
    image_paths: list[str],
    output_path: str,
    cols: int = 4,
    rows: int = 3,
    spacing: int = 12,
    padding: int = 20,
    bg_color: tuple = (255, 255, 255),
    border_radius: int = 4,
    labels: Optional[list[str]] = None,
    label_font_size: int = 11,
    label_color: str = "#333333",
    watermark: Optional[str] = None,
    max_resolution: tuple = (8192, 8192),
) -> str:
    """
    Generate a professional product grid collage.

    Args:
        image_paths: List of paths to input images.
        output_path: Where to save the final PNG.
        cols: Number of columns.
        rows: Maximum number of rows (auto-adjusted if fewer images).
        spacing: Pixel gap between cells.
        padding: Outer padding.
        bg_color: Background RGB color.
        border_radius: Rounded corner radius for each cell.
        labels: Optional list of color/label strings per image.
        label_font_size: Font size for labels.
        label_color: Hex color for label text.
        watermark: Optional watermark text.
        max_resolution: Maximum output dimensions.

    Returns:
        Path to the output grid image.
    """
    if not image_paths:
        raise ValueError("No images provided for grid generation")

    n_images = len(image_paths)
    actual_rows = ceil(n_images / cols)

    # Load all images
    images = []
    for p in image_paths:
        if not os.path.isfile(p):
            print(f"[WARN] Image not found: {p}", file=sys.stderr)
            continue
        img = Image.open(p).convert("RGBA")
        images.append(img)

    if not images:
        raise ValueError("No valid images could be loaded")

    n_actual = len(images)

    # Determine cell size (uniform)
    max_w = max(img.width for img in images)
    max_h = max(img.height for img in images)

    # Scale down if output would exceed max_resolution
    canvas_w = padding * 2 + cols * max_w + (cols - 1) * spacing
    canvas_h = padding * 2 + actual_rows * max_h + (actual_rows - 1) * spacing

    # Add space for labels
    label_height = label_font_size + 8 if labels else 0
    canvas_h += actual_rows * label_height

    scale = min(1.0, max_resolution[0] / canvas_w, max_resolution[1] / canvas_h)
    if scale < 1.0:
        max_w = int(max_w * scale)
        max_h = int(max_h * scale)
        canvas_w = int(canvas_w * scale)
        canvas_h = int(canvas_h * scale)
        spacing = int(spacing * scale)
        padding = int(padding * scale)
        label_height = int(label_height * scale)
        label_font_size = int(label_font_size * scale)

    # Create canvas
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (*bg_color, 255))
    draw = ImageDraw.Draw(canvas)

    # Try to load font (fallback to default)
    font = None
    try:
        font = ImageFont.truetype("arial.ttf", label_font_size)
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", label_font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()

    # Place images
    for idx, img in enumerate(images):
        col = idx % cols
        row = idx // cols
        if row >= actual_rows:
            break

        # Resize to cell dimensions (maintain aspect ratio)
        cell_w, cell_h = max_w, max_h
        img_resized = img.resize((cell_w, cell_h), Image.LANCZOS)

        # Calculate position
        x = padding + col * (cell_w + spacing)
        y = padding + row * (cell_h + spacing + label_height)

        # Create rounded rectangle clip
        if border_radius > 0:
            mask = Image.new("L", (cell_w, cell_h), 0)
            mask_draw = ImageDraw.Draw(mask)
            mask_draw.rounded_rectangle(
                [(0, 0), (cell_w, cell_h)],
                radius=border_radius, fill=255,
            )
            # Apply rounded corners
            cell_with_alpha = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
            cell_with_alpha.paste(img_resized, (0, 0), mask)
            canvas.paste(cell_with_alpha, (x, y), cell_with_alpha)
        else:
            canvas.paste(img_resized, (x, y), img_resized)

        # Draw label
        if labels and idx < len(labels) and labels[idx]:
            label_y = y + cell_h + 4
            label_text = labels[idx]
            # Center text under cell
            try:
                bbox = draw.textbbox((0, 0), label_text, font=font)
                text_w = bbox[2] - bbox[0]
            except Exception:
                text_w = len(label_text) * label_font_size * 0.6
            text_x = x + (cell_w - text_w) / 2
            draw.text((text_x, label_y), label_text, fill=label_color, font=font)

    # Add cell outline rectangles for empty cells
    for idx in range(n_actual, cols * actual_rows):
        col = idx % cols
        row = idx // cols
        if row >= actual_rows:
            break
        x = padding + col * (max_w + spacing)
        y = padding + row * (max_h + spacing + label_height)
        draw.rectangle(
            [x, y, x + max_w, y + max_h],
            outline="#e0e0e0", width=1,
        )

    # Watermark
    if watermark:
        try:
            wm_bbox = draw.textbbox((0, 0), watermark, font=font)
            wm_w = wm_bbox[2] - wm_bbox[0]
            wm_h = wm_bbox[3] - wm_bbox[1]
            wm_x = canvas_w - wm_w - padding
            wm_y = canvas_h - wm_h - padding
            # Semi-transparent
            watermark_overlay = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
            wm_draw = ImageDraw.Draw(watermark_overlay)
            wm_draw.text((wm_x, wm_y), watermark, fill=(128, 128, 128, 80), font=font)
            canvas = Image.alpha_composite(canvas, watermark_overlay)
        except Exception:
            pass

    # Save
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    canvas.save(output_path, "PNG")
    print(f"[OK] Grid saved: {output_path} ({canvas_w}x{canvas_h})", file=sys.stderr)
    return output_path


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Grid Collage Generator")
    p.add_argument("--images", nargs="+", required=True, help="Input image paths")
    p.add_argument("--output", required=True, help="Output PNG path")
    p.add_argument("--cols", type=int, default=4, help="Number of columns")
    p.add_argument("--rows", type=int, default=0, help="Max rows (0 = auto)")
    p.add_argument("--spacing", type=int, default=12, help="Cell spacing in pixels")
    p.add_argument("--padding", type=int, default=20, help="Outer padding")
    p.add_argument("--labels", nargs="*", default=None, help="Cell label strings")
    p.add_argument("--labelFontSize", type=int, default=11)
    p.add_argument("--borderRadius", type=int, default=4)
    p.add_argument("--watermark", default=None)
    p.add_argument("--bgColor", default="255,255,255", help="RGB tuple")
    p.add_argument("--layout", choices=list(GRID_LAYOUTS.keys()), default=None,
                   help="Preset layout name (overrides cols/rows)")
    p.add_argument("--jsonMode", action="store_true")
    return p


def main() -> int:
    args = build_parser().parse_args()

    if args.layout and args.layout in GRID_LAYOUTS:
        cols = GRID_LAYOUTS[args.layout]["cols"]
        rows = GRID_LAYOUTS[args.layout]["rows"]
    else:
        cols = args.cols
        rows = args.rows if args.rows > 0 else 99

    bg = tuple(int(x.strip()) for x in args.bgColor.split(",")[:3])

    try:
        out_path = generate_grid(
            image_paths=args.images,
            output_path=args.output,
            cols=cols,
            rows=rows,
            spacing=args.spacing,
            padding=args.padding,
            bg_color=bg,
            border_radius=args.borderRadius,
            labels=args.labels,
            label_font_size=args.labelFontSize,
            watermark=args.watermark,
        )

        if args.jsonMode:
            print(json.dumps({"status": "success", "path": out_path}), flush=True)
        return 0

    except Exception as exc:
        if args.jsonMode:
            print(json.dumps({"status": "error", "reason": str(exc)}), flush=True)
        else:
            print(f"[ERR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
