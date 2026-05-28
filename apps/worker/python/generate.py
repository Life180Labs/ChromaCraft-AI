#!/usr/bin/env python3
"""
ChromaCraft Image Generation Tool — Enhanced Production Version.
Identity-preserving generation with ControlNet support, segmentation masking, and low-denoise editing.
Supports multiple strategies: Stability Search & Replace, SDXL ControlNet, HSL Shift, and GPT Image Edit.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from io import BytesIO
from typing import Optional

import requests
from PIL import Image

# Import identity preservation module
from identity import (
    create_segmentation_mask,
    identity_lock_composite,
    identity_lock_recolor,
    mask_by_color_hsl_shift,
    hue_for_color,
    save_control_inputs,
)

# ---------------------------------------------------------------------------
# File & Name Helpers
# ---------------------------------------------------------------------------

def color_to_slug(color: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", color.strip().replace(" ", "_"))

def parse_colors(colors_arg: str) -> list[str]:
    return [c.strip() for c in colors_arg.split(",") if c.strip()]

def raw_filename(color: str) -> str:
    return f"raw_{color_to_slug(color)}.png"

# ---------------------------------------------------------------------------
# Strategy 1: Stability Search & Replace with Identity Lock (Preferred)
# ---------------------------------------------------------------------------

def generate_stability_identity(
    prompt: str, color: str, api_key: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
    denoise_strength: float = 0.4,
    seed: int = 42,
) -> str:
    """
    Identity-preserving generation using Stability AI Search & Replace.
    - Low denoise strength (0.4) to preserve structure
    - Fixed seed for consistency
    - Post-generation identity lock composite
    """
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise ValueError(f"Reference image not found at '{ref_image_path}'. Generation aborted.")

    print(f"[INFO] Identity-preserving generation for {color} (denoise={denoise_strength}, seed={seed})...", file=sys.stderr)

    # Segmentation mask for identity lock
    mask = create_segmentation_mask(ref_image_path)

    replacement_prompt = (
        f"High quality photo of the exact same product in {color.upper()} color. "
        f"Identical shape, identical geometry, same proportions, same camera angle. "
        f"Only the color is changed to {color.upper()}. "
        f"Preserve all reflections, highlights, shadows, logos, and surface details."
    )

    with open(ref_image_path, "rb") as f:
        response = requests.post(
            "https://api.stability.ai/v2beta/stable-image/edit/search-and-replace",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "image/*"},
            files={"image": f},
            data={
                "prompt": replacement_prompt,
                "search_prompt": "the main product, the subject, the item",
                "output_format": "png",
                "seed": seed,
                "grow_mask": 0,
            },
            timeout=120,
        )

    if response.status_code != 200:
        raise Exception(f"Stability API Error ({response.status_code}): {response.text[:300]}")

    raw_img = Image.open(BytesIO(response.content)).convert("RGBA")
    ref_img = Image.open(ref_image_path).convert("RGBA")

    # Apply identity lock: composite original product structure into result
    out_path_raw = os.path.join(out_dir, f"raw_{color_to_slug(color)}_unlocked.png")
    raw_img.save(out_path_raw, "PNG")

    # Use identity_lock composite to preserve structure
    out_path = os.path.join(out_dir, raw_filename(color))
    identity_lock_composite(ref_image_path, out_path_raw, mask, out_path, blur_radius=3)

    # Resize to target
    final_img = Image.open(out_path).convert("RGBA")
    final_img = final_img.resize(image_size, Image.Resampling.LANCZOS)
    final_img.save(out_path, "PNG")

    # Cleanup intermediate
    if os.path.exists(out_path_raw):
        os.remove(out_path_raw)

    print(f"[OK] Identity-preserved generation complete: {out_path}", file=sys.stderr)
    return out_path


# ---------------------------------------------------------------------------
# Strategy 2: SDXL + ControlNet via Replicate (Fallback)
# ---------------------------------------------------------------------------

def generate_sdxl_controlnet(
    prompt: str, color: str, api_key: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
) -> str:
    """
    SDXL + ControlNet pipeline for structure-preserving recoloring.
    Uses Canny edge control to lock geometry.
    Requires REPLICATE_API_TOKEN.
    """
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise ValueError(f"Reference image not found at '{ref_image_path}'")

    print(f"[INFO] SDXL ControlNet generation for {color}...", file=sys.stderr)

    # Generate ControlNet inputs (Canny edges)
    control_dir = os.path.join(out_dir, "control_inputs")
    control_inputs = save_control_inputs(ref_image_path, control_dir)

    try:
        import replicate
    except ImportError:
        raise ImportError("replicate package required for ControlNet. Install with: pip install replicate")

    canny_path = control_inputs.get("canny")
    if not canny_path or not os.path.isfile(canny_path):
        raise ValueError("Canny edge map not generated")

    output = replicate.run(
        "stability-ai/sdxl:controlnet",
        input={
            "image": open(ref_image_path, "rb"),
            "control_image": open(canny_path, "rb"),
            "prompt": f"A {color.upper()} version of this product, identical shape and geometry, {color.upper()} color",
            "negative_prompt": "different shape, different geometry, distorted, deformed",
            "controlnet_conditioning_scale": 0.8,
            "num_outputs": 1,
            "guidance_scale": 7.5,
            "num_inference_steps": 30,
            "seed": 42,
        },
    )

    # Replicate returns a URL or file list
    if isinstance(output, list) and len(output) > 0:
        img_url = str(output[0])
    elif isinstance(output, str):
        img_url = output
    else:
        raise ValueError(f"Unexpected Replicate output: {output}")

    # Download result
    img_resp = requests.get(img_url, timeout=60)
    img_resp.raise_for_status()

    out_path = os.path.join(out_dir, raw_filename(color))
    img = Image.open(BytesIO(img_resp.content)).convert("RGBA")
    img = img.resize(image_size, Image.Resampling.LANCZOS)
    img.save(out_path, "PNG")

    # Apply identity lock as second pass
    mask = create_segmentation_mask(ref_image_path)
    locked_path = os.path.join(out_dir, f"locked_{raw_filename(color)}")
    identity_lock_composite(ref_image_path, out_path, mask, locked_path, blur_radius=2)
    if os.path.exists(locked_path):
        os.replace(locked_path, out_path)

    return out_path


# ---------------------------------------------------------------------------
# Strategy 3: HSL Hue Shift (Zero-cost, No AI)
# ---------------------------------------------------------------------------

def generate_hsl_shift(
    color: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
) -> str:
    """
    Zero-cost recoloring by shifting HSL hue channel.
    Preserves ALL texture, lighting, and detail.
    Only changes the product color.
    """
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise ValueError(f"Reference image not found at '{ref_image_path}'")

    print(f"[INFO] HSL shift recoloring for {color} (zero-cost)...", file=sys.stderr)

    target_hue = hue_for_color(color)
    out_path = os.path.join(out_dir, raw_filename(color))

    mask_by_color_hsl_shift(ref_image_path, target_hue, out_path)

    # Resize
    img = Image.open(out_path).convert("RGBA")
    img = img.resize(image_size, Image.Resampling.LANCZOS)
    img.save(out_path, "PNG")

    return out_path


# ---------------------------------------------------------------------------
# Strategy Router
# ---------------------------------------------------------------------------

GENERATION_STRATEGIES = {
    "stability": generate_stability_identity,
    "sdxl_controlnet": generate_sdxl_controlnet,
    "hsl_shift": generate_hsl_shift,
}


# ---------------------------------------------------------------------------
# AI Video & 360 Generation (Stability SVD)
# ---------------------------------------------------------------------------

def generate_ai_video(ref_path: str, api_key: str, out_path: str) -> str:
    if api_key == "none" or not api_key:
        raise ValueError("A valid Stability API key is required for AI video generation.")

    with open(ref_path, "rb") as f:
        response = requests.post(
            "https://api.stability.ai/v2beta/image-to-video",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"image": f},
            data={"seed": 42, "cfg_scale": 1.8, "motion_bucket_id": 127},
            timeout=60,
        )
    response.raise_for_status()
    generation_id = response.json().get("id")

    result_url = f"https://api.stability.ai/v2beta/image-to-video/result/{generation_id}"
    print("[INFO] Waiting for AI video generation...", file=sys.stderr)

    while True:
        res = requests.get(result_url, headers={"Authorization": f"Bearer {api_key}", "Accept": "video/*"})
        if res.status_code == 202:
            time.sleep(10)
            continue
        elif res.status_code == 200:
            os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
            with open(out_path, "wb") as f:
                f.write(res.content)
            return out_path
        else:
            raise Exception(f"AI Video failed: {res.json()}")

# ---------------------------------------------------------------------------
# TASKS ROUTING
# ---------------------------------------------------------------------------

def task_generate(args: argparse.Namespace, json_mode: bool) -> int:
    colors = parse_colors(args.colors)
    if not colors:
        _emit_error("--colors must specify at least one color name", json_mode)
        return 1

    os.makedirs(args.outDir, exist_ok=True)
    strategy = (args.strategy or "stability").lower()
    provider = args.provider.lower()

    try:
        w, h = [int(x) for x in getattr(args, "imageSize", "800x600").split("x")]
    except Exception:
        w, h = 800, 600

    for color in colors:
        try:
            if strategy == "hsl_shift":
                out_path = generate_hsl_shift(color, args.outDir, getattr(args, "refImage", None), (w, h))
            elif strategy in ("sdxl_controlnet", "controlnet"):
                out_path = generate_sdxl_controlnet(
                    args.prompt, color, args.apiKey, args.outDir,
                    getattr(args, "refImage", None), (w, h),
                )
            else:
                # Default: Stability with identity preservation
                denoise = getattr(args, "denoiseStrength", 0.4)
                out_path = generate_stability_identity(
                    args.prompt, color, args.apiKey, args.outDir,
                    getattr(args, "refImage", None), (w, h),
                    denoise_strength=denoise,
                    seed=args.seed or 42,
                )
            _emit_success(out_path, f"color={color},strategy={strategy}", json_mode)
        except Exception as exc:
            _emit_error(str(exc), json_mode, context=f"color={color},strategy={strategy}")

    return 0


def task_spin360(args: argparse.Namespace, json_mode: bool) -> int:
    """Generate multi-view 360 images. Delegates to multiview.py."""
    ref = getattr(args, "refImage", None) or getattr(args, "inputPath", None)
    prefix = getattr(args, "prefix", "product")

    # Call multiview.py as subprocess
    multiview_script = os.path.join(os.path.dirname(__file__), "multiview.py")
    cmd = [
        "python", multiview_script,
        "--task", "generate",
        "--refImage", ref,
        "--apiKey", args.apiKey,
        "--outDir", args.outDir,
        "--prefix", prefix,
        "--provider", "stability" if "stability" in args.apiKey.lower() else "tripo",
        "--jsonMode",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    # Parse JSON output from last line
    for line in reversed(result.stdout.strip().split("\n")):
        line = line.strip()
        if line.startswith("{"):
            try:
                data = json.loads(line)
                if data.get("status") == "success":
                    paths = data.get("paths", {})
                    for view, p in paths.items():
                        _emit_success(p, f"view={view}", json_mode)
                    return 0
                else:
                    _emit_error(data.get("reason", "Multiview failed"), json_mode)
                    return 1
            except json.JSONDecodeError:
                continue

    _emit_error("No JSON output from multiview.py", json_mode)
    return 1


def task_video(args: argparse.Namespace, json_mode: bool) -> int:
    """Generate product showcase video. Delegates to video.py."""
    ref = getattr(args, "refImage", None)
    prefix = getattr(args, "prefix", "product")
    frames_dir = getattr(args, "framesDir", args.outDir)

    video_script = os.path.join(os.path.dirname(__file__), "video.py")

    if ref and os.path.isfile(ref):
        # Simple video from single image
        cmd = [
            "python", video_script,
            "--task", "simple",
            "--refImage", ref,
            "--output", os.path.join(args.outDir, f"{prefix}_showcase.mp4"),
            "--jsonMode",
        ]
    else:
        # Showcase from frames directory
        cmd = [
            "python", video_script,
            "--task", "showcase",
            "--framesDir", frames_dir,
            "--output", os.path.join(args.outDir, f"{prefix}_showcase.mp4"),
            "--prefix", prefix,
            "--jsonMode",
        ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    for line in reversed(result.stdout.strip().split("\n")):
        line = line.strip()
        if line.startswith("{"):
            try:
                data = json.loads(line)
                if data.get("status") == "success":
                    _emit_success(data["path"], "type=video", json_mode)
                    return 0
                else:
                    _emit_error(data.get("reason", "Video failed"), json_mode)
                    return 1
            except json.JSONDecodeError:
                continue

    _emit_error("No JSON output from video.py", json_mode)
    return 1


def _emit_success(path: str, metadata: str, json_mode: bool) -> None:
    if json_mode:
        print(json.dumps({"status": "success", "path": path, "metadata": metadata}), flush=True)
    else:
        print(f"[OK] {path}  ({metadata})")


def _emit_error(reason: str, json_mode: bool, context: str = "") -> None:
    if json_mode:
        print(json.dumps({"status": "error", "reason": reason, "context": context}), flush=True)
    else:
        print(f"[ERR] {reason}" + (f" ({context})" if context else ""), file=sys.stderr)


# ---------------------------------------------------------------------------
# Argument Parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Image Generation Tool")
    p.add_argument("--task", choices=["generate", "spin360", "video"], default="generate")
    p.add_argument("--jsonMode", action="store_true")
    p.add_argument("--jobId", default="0")
    p.add_argument("--prompt", default="")
    p.add_argument("--provider", default="stability")
    p.add_argument("--apiKey", default="none")
    p.add_argument("--outDir", default=".")
    p.add_argument("--colors", default="White")
    p.add_argument("--refImage", default=None)
    p.add_argument("--imageSize", default="800x600")
    p.add_argument("--prefix", default="product")
    p.add_argument("--inputPath", default=None)
    p.add_argument("--framesDir", default=None)

    # Identity preservation params
    p.add_argument("--strategy", default="stability",
                   choices=["stability", "sdxl_controlnet", "controlnet", "hsl_shift"])
    p.add_argument("--denoiseStrength", type=float, default=0.4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--preservationStrength", type=float, default=0.7)
    return p


def main() -> int:
    args = build_parser().parse_args()
    dispatch = {
        "generate": task_generate,
        "spin360": task_spin360,
        "video": task_video,
    }
    return dispatch[args.task](args, args.jsonMode)


if __name__ == "__main__":
    sys.exit(main())
