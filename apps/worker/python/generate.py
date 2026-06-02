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
    mask_by_color_hsl_shift,
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
# Shared helpers
# ---------------------------------------------------------------------------

def _resolve_api_key(cli_key: str) -> str:
    """CLI flag takes priority, then env var."""
    if cli_key and cli_key != "none":
        return cli_key
    env_key = os.environ.get("CHROMACRAFT_API_KEY", "none")
    return env_key if env_key else "none"


def _identity_prompt(color: str, prompt: str) -> str:
    """Append color change to the full prompt from orchestrator (includes identity, context, variations)."""
    return f"{prompt} Change the color to {color}."


# ---------------------------------------------------------------------------
# Strategy 1: Stability ControlNet Structure (Primary — best identity preservation)
# ---------------------------------------------------------------------------

def generate_stability_identity(
    prompt: str, color: str, api_key: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (0, 0),
    denoise_strength: float = 0.4,
    seed: int = 42,
) -> str:
    """
    Identity-preserving generation using Stability AI ControlNet Structure.
    High control_strength (0.95) forces exact geometry preservation.
    """
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise ValueError(f"Reference image not found at '{ref_image_path}'. Generation aborted.")

    api_key = _resolve_api_key(api_key)
    if api_key == "none":
        raise ValueError("Stability API key required. Set CHROMACRAFT_API_KEY env var or pass --apiKey.")

    color_prompt = _identity_prompt(color, prompt)
    control_strength = 1.0  # Maximum preservation — prevents hallucination

    print(f"[INFO] ControlNet Structure generation for {color} (control_strength={control_strength:.2f}, seed={seed})...", file=sys.stderr)

    with open(ref_image_path, "rb") as f:
        response = requests.post(
            "https://api.stability.ai/v2beta/stable-image/control/structure",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "image/*"},
            files={"image": f},
            data={
                "prompt": color_prompt,
                "control_strength": str(control_strength),
                "output_format": "png",
                "seed": str(seed),
            },
            timeout=120,
        )

    if response.status_code != 200:
        error_body = response.text[:1000]
        print(f"[STABILITY_API_ERROR] Status {response.status_code}: {error_body}", file=sys.stderr)
        raise Exception(f"Stability API Error ({response.status_code}): {error_body}")

    raw_img = Image.open(BytesIO(response.content)).convert("RGBA")
    
    out_path = os.path.join(out_dir, raw_filename(color))
    raw_img.save(out_path, "PNG")

    print(f"[OK] Generative color pass complete: {out_path} ({raw_img.size[0]}x{raw_img.size[1]})", file=sys.stderr)
    return out_path


# ---------------------------------------------------------------------------
# Strategy 2: ControlNet / SDXL (always delegates to Stability primary)
# ---------------------------------------------------------------------------

def generate_sdxl_controlnet(
    prompt: str, color: str, api_key: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
) -> str:
    """Fallback: delegates to ControlNet Structure."""
    print(f"[INFO] Using ControlNet Structure for {color}.", file=sys.stderr)
    return generate_stability_identity(prompt, color, api_key, out_dir, ref_image_path, image_size)


# ---------------------------------------------------------------------------
# Strategy 3: HSL Hue Shift (Zero-cost, No AI)
# ---------------------------------------------------------------------------

def generate_hsl_shift(
    color: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (0, 0),
) -> str:
    """
    Zero-cost recoloring by shifting HSL hue channel.
    Preserves ALL texture, lighting, and detail at original resolution.
    Only changes the product color.
    """
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise ValueError(f"Reference image not found at '{ref_image_path}'")

    print(f"[INFO] HSL shift recoloring for {color} (zero-cost)...", file=sys.stderr)

    target_hue = hue_for_color(color)
    out_path = os.path.join(out_dir, raw_filename(color))
    mask_by_color_hsl_shift(ref_image_path, target_hue, out_path)

    return out_path


# ---------------------------------------------------------------------------
# Strategy 4: Google Gemini (Direct Generative Recoloring via ThreadPoolExecutor)
# ---------------------------------------------------------------------------

def generate_gemini_multithread(
    prompt: str,
    colors: list[str],
    api_key: str,
    out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
    max_workers: int = 3,
) -> dict[str, str]:
    """
    Direct Gemini recoloring strategy.
    Uploads base reference asset to Google File API once.
    Fires concurrent worker threads to request variant images from gemini-2.0-flash-preview-image-generation.
    Cleans up the uploaded file in a finally block.
    """
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise ValueError(f"Reference image not found at '{ref_image_path}'. Gemini recolor aborted.")

    resolved_key = api_key if (api_key and api_key != "none") else os.environ.get("GEMINI_API_KEY", os.environ.get("CHROMACRAFT_API_KEY", "none"))
    if resolved_key == "none":
        raise ValueError("Google Gemini API key required. Set GEMINI_API_KEY or CHROMACRAFT_API_KEY, or pass --apiKey.")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        raise ImportError("google-genai library is missing. Install using: pip install google-genai")

    import io
    import random
    from concurrent.futures import ThreadPoolExecutor, as_completed

    # Initialize Gemini client
    client = genai.Client(api_key=resolved_key)
    
    # Check dimensions of the original image
    try:
        original_image = Image.open(ref_image_path)
        orig_width, orig_height = original_image.size
    except Exception as e:
        raise RuntimeError(f"Failed to open reference image: {e}")

    # Stage base asset to Google File API
    print(f"[Cloud] Staging base asset '{ref_image_path}' to Google File API...", file=sys.stderr)
    try:
        uploaded_file = client.files.upload(file=ref_image_path)
        print(f"[Cloud] Asset staged. URI: {uploaded_file.uri}", file=sys.stderr)
    except Exception as e:
        raise RuntimeError(f"Google Cloud upload failed: {e}")

    # Default model from modern Google GenAI library: gemini-2.0-flash-preview-image-generation or gemini-3.1-flash-image (as requested by user)
    # We fallback to "gemini-2.0-flash-preview-image-generation" if gemini-3.1-flash-image has model naming resolution issues, but we use the user's MODEL_ID
    model_id = "gemini-2.0-flash-preview-image-generation"  # Current correct production name for image generation/edit
    if os.environ.get("GEMINI_MODEL_ID"):
        model_id = os.environ.get("GEMINI_MODEL_ID")

    def worker_generate_variant(color: str, max_retries: int = 3) -> tuple[str, Optional[str]]:
        worker_prompt = prompt.replace("[COLOR]", color).replace("[color]", color) if prompt else f"Modify the color to be {color}. Keep all other details identical."
        
        contents = [{
            "role": "user",
            "parts": [
                {"text": worker_prompt},
                {"file_data": {"file_uri": uploaded_file.uri, "mime_type": uploaded_file.mime_type}}
            ]
        }]

        for attempt in range(max_retries):
            try:
                print(f"   -> [Thread {color}] Requesting Gemini variant (Attempt {attempt + 1})...", file=sys.stderr)
                response = client.models.generate_content(
                    model=model_id,
                    contents=contents
                )
                
                for part in response.parts:
                    if part.inline_data:
                        img = Image.open(io.BytesIO(part.inline_data.data)).convert("RGBA")
                        
                        # Handle dimension normalization if required
                        if img.size != (orig_width, orig_height):
                            img = img.resize((orig_width, orig_height), Image.Resampling.LANCZOS)
                            
                        save_path = os.path.join(out_dir, raw_filename(color))
                        img.save(save_path, "PNG")
                        print(f"   ✅ [Thread {color}] Success. Saved to {save_path}", file=sys.stderr)
                        return color, save_path
                
                print(f"   ⚠️ [Thread {color}] Warning: Empty response parts or no inline image data.", file=sys.stderr)
            except Exception as e:
                error_msg = str(e).lower()
                if any(x in error_msg for x in ["429", "quota", "rate limit", "resource_exhausted"]):
                    if attempt < max_retries - 1:
                        sleep_time = (2 ** attempt) + random.uniform(0.5, 1.5)
                        print(f"   ⏳ [Thread {color}] Rate limited. Backing off for {sleep_time:.1f}s...", file=sys.stderr)
                        time.sleep(sleep_time)
                        continue
                print(f"   ❌ [Thread {color}] Permanent failure: {e}", file=sys.stderr)
                break
                
        return color, None

    results = {}
    try:
        print(f"[Gemini] Launching concurrent bulk generation (max_workers={max_workers})...", file=sys.stderr)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(worker_generate_variant, color): color
                for color in colors
            }
            for future in as_completed(futures):
                color, path = future.result()
                if path:
                    results[color] = path
    finally:
        print("[Cloud] Purging temporary asset from Google servers...", file=sys.stderr)
        try:
            client.files.delete(name=uploaded_file.name)
        except Exception as e:
            print(f"[Cloud] Warning: Could not cleanly delete cloud file: {e}", file=sys.stderr)

    return results

# ---------------------------------------------------------------------------
# Strategy Router
# ---------------------------------------------------------------------------

GENERATION_STRATEGIES = {
    "stability": generate_stability_identity,
    "sdxl_controlnet": generate_sdxl_controlnet,
    "hsl_shift": generate_hsl_shift,
    "controlnet": generate_stability_identity,
}


# ---------------------------------------------------------------------------
# AI Video & 360 Generation (Stability SVD)
# ---------------------------------------------------------------------------

def generate_ai_video(ref_path: str, out_path: str) -> str:
    api_key = _resolve_api_key("none")
    if api_key == "none":
        raise ValueError("A valid Stability API key is required for AI video generation. Set CHROMACRAFT_API_KEY env var.")

    with open(ref_path, "rb") as f:
        response = requests.post(
            "https://api.stability.ai/v2beta/image-to-video",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"image": f},
            data={
                "seed": "42", 
                "cfg_scale": "1.8", 
                "motion_bucket_id": "127"
            },
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
    strategy = (args.strategy or "hsl_shift").lower()
    provider = args.provider.lower()

    try:
        w, h = [int(x) for x in getattr(args, "imageSize", "800x600").split("x")]
    except Exception:
        w, h = 800, 600

    if provider == "mock":
        for color in colors:
            out_path = os.path.join(args.outDir, raw_filename(color))
            try:
                img = Image.new("RGBA", (w, h), color.lower().replace(" ", "").replace("_", ""))
            except Exception:
                img = Image.new("RGBA", (w, h), "gray")
            img.save(out_path, "PNG")
            _emit_success(out_path, f"color={color},strategy={strategy}", json_mode)
        return 0

    # If the user selects the gemini strategy, run it concurrently for all colors
    if strategy == "gemini":
        try:
            results = generate_gemini_multithread(
                prompt=args.prompt,
                colors=colors,
                api_key=args.apiKey,
                out_dir=args.outDir,
                ref_image_path=getattr(args, "refImage", None),
                image_size=(w, h),
            )
            for color in colors:
                if color in results:
                    _emit_success(results[color], f"color={color},strategy={strategy}", json_mode)
                else:
                    _emit_error(f"Gemini generation failed for color {color}", json_mode, context=f"color={color},strategy={strategy}")
        except Exception as exc:
            _emit_error(str(exc), json_mode, context=f"strategy={strategy}")
        return 0

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

    # Call multiview.py as subprocess (API key passed via env for security)
    multiview_script = os.path.join(os.path.dirname(__file__), "multiview.py")
    env = os.environ.copy()
    env["CHROMACRAFT_API_KEY"] = args.apiKey
    cmd = [
        "python", multiview_script,
        "--task", "generate",
        "--refImage", ref,
        "--outDir", args.outDir,
        "--prefix", prefix,
        "--provider", "stability" if "stability" in args.apiKey.lower() else "tripo",
        "--jsonMode",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env)

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
    env = os.environ.copy()
    env["CHROMACRAFT_API_KEY"] = args.apiKey

    if ref and os.path.isfile(ref):
        cmd = [
            "python", video_script,
            "--task", "simple",
            "--refImage", ref,
            "--output", os.path.join(args.outDir, f"{prefix}_showcase.mp4"),
            "--jsonMode",
        ]
    else:
        cmd = [
            "python", video_script,
            "--task", "showcase",
            "--framesDir", frames_dir,
            "--output", os.path.join(args.outDir, f"{prefix}_showcase.mp4"),
            "--prefix", prefix,
            "--jsonMode",
        ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env)

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


def generate_lifestyle_scenes(
    ref_image_path: str,
    target_audience: str,
    target_market: str,
    target_purpose: str,
    additional_context: str,
    api_key: str,
    out_dir: str,
    prefix: str,
) -> list[str]:
    """
    Generate 3 lifestyle/scenery images based on targeting context.
    Uses Google Gemini to edit/generate a scene around the product.
    """
    try:
        from google import genai
    except ImportError:
        print("[ERR] google-genai library missing, cannot run lifestyle generation", file=sys.stderr)
        return []

    import io
    client = genai.Client(api_key=api_key)
    
    # Upload reference image
    print(f"[Lifestyle] Staging reference asset '{ref_image_path}' to Google File API...", file=sys.stderr)
    try:
        uploaded_file = client.files.upload(file=ref_image_path)
    except Exception as e:
        print(f"[Lifestyle] Google Cloud upload failed: {e}", file=sys.stderr)
        return []
    
    model_id = "gemini-2.0-flash-preview-image-generation"
    if os.environ.get("GEMINI_MODEL_ID"):
        model_id = os.environ.get("GEMINI_MODEL_ID")

    scenes = [
        "Render the product placed naturally in a premium minimalist modern showcase setting.",
        "Render the product placed naturally in a dynamic urban city environment during golden hour.",
        "Render the product placed naturally in a professional outdoor lifestyle setting matching the target audience."
    ]
    
    output_paths = []
    for i, scene_base in enumerate(scenes):
        prompt = (
            f"{scene_base} The target audience is {target_audience} in the {target_market} market. "
            f"The purpose is {target_purpose}. {additional_context or ''} "
            f"Ensure the product from the source image remains completely unchanged and is integrated naturally into the background."
        )
        
        contents = [{
            "role": "user",
            "parts": [
                {"text": prompt},
                {"file_data": {"file_uri": uploaded_file.uri, "mime_type": uploaded_file.mime_type}}
            ]
        }]
        
        try:
            print(f"[Lifestyle] Requesting scene {i+1}...", file=sys.stderr)
            response = client.models.generate_content(
                model=model_id,
                contents=contents
            )
            for part in response.parts:
                if part.inline_data:
                    img = Image.open(io.BytesIO(part.inline_data.data)).convert("RGBA")
                    save_path = os.path.join(out_dir, f"{prefix}_lifestyle_{i+1}.png")
                    img.save(save_path, "PNG")
                    output_paths.append(save_path)
                    print(f"[Lifestyle] Saved scene {i+1} to {save_path}", file=sys.stderr)
                    break
        except Exception as e:
            print(f"[Lifestyle] Failed to generate scene {i+1}: {e}", file=sys.stderr)
            
    try:
        client.files.delete(name=uploaded_file.name)
    except Exception as e:
        print(f"[Lifestyle] Warning: Could not cleanly delete cloud file: {e}", file=sys.stderr)
        
    return output_paths


def task_lifestyle(args: argparse.Namespace, json_mode: bool) -> int:
    ref = getattr(args, "refImage", None)
    if not ref or not os.path.isfile(ref):
        _emit_error("Reference image required for lifestyle generation", json_mode)
        return 1
        
    resolved_key = args.apiKey if (args.apiKey and args.apiKey != "none") else os.environ.get("GEMINI_API_KEY", os.environ.get("CHROMACRAFT_API_KEY", "none"))
    if resolved_key == "none":
        _emit_error("API key required for lifestyle generation", json_mode)
        return 1
        
    try:
        paths = generate_lifestyle_scenes(
            ref_image_path=ref,
            target_audience=getattr(args, "targetAudience", "General consumers"),
            target_market=getattr(args, "targetMarket", "Global"),
            target_purpose=getattr(args, "targetPurpose", "Product catalog"),
            additional_context=getattr(args, "additionalContext", ""),
            api_key=resolved_key,
            out_dir=args.outDir,
            prefix=args.prefix,
        )
        if not paths:
            _emit_error("No lifestyle scenes generated", json_mode)
            return 1
        for p in paths:
            _emit_success(p, "type=lifestyle", json_mode)
        return 0
    except Exception as exc:
        _emit_error(str(exc), json_mode)
        return 1


# ---------------------------------------------------------------------------
# Argument Parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Image Generation Tool")
    p.add_argument("--task", choices=["generate", "spin360", "video", "lifestyle"], default="generate")
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
    
    # Lifestyle arguments
    p.add_argument("--targetAudience", default="General consumers")
    p.add_argument("--targetMarket", default="Global")
    p.add_argument("--targetPurpose", default="Product catalog")
    p.add_argument("--additionalContext", default="")

    # Default to hsl_shift when running CLI manually (pipeline always passes strategy explicitly)
    p.add_argument("--strategy", default="hsl_shift",
                   choices=["stability", "sdxl_controlnet", "controlnet", "hsl_shift", "gemini"])
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
        "lifestyle": task_lifestyle,
    }
    return dispatch[args.task](args, args.jsonMode)


if __name__ == "__main__":
    sys.exit(main())