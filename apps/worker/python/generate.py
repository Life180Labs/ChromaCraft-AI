#!/usr/bin/env python3
"""
ChromaCraft Image Generation Tool — Gemini Edition.
Identity-preserving color variant generation using Google Gemini APIs exclusively.
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

from PIL import Image

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
        raise ValueError(f"Reference image not found at '{ref_image_path}'. Image generation requires a reference image.")

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

    # Initialize Gemini client (once)
    client = genai.Client(api_key=resolved_key)
    
    # Initialize variables for the reference image
    uploaded_file = None
    orig_width, orig_height = image_size
    
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise RuntimeError(f"Reference image is missing or invalid: {ref_image_path}")

    try:
        original_image = Image.open(ref_image_path)
        orig_width, orig_height = original_image.size
    except Exception as e:
        raise RuntimeError(f"Failed to open reference image: {e}")

    # ── Files API caching (P2.8) ─────────────────────────────────────────────
    # Avoid re-uploading the reference image on every generation run.
    # Cache the Files API URI and expiry in the CACHED_FILE_URI / CACHED_FILE_EXPIRY
    # env vars (set by the worker before invoking this script).
    # Google Files API files expire after 48 hours — we use a 47h TTL for safety.
    import datetime
    cached_uri = os.environ.get("CACHED_FILE_URI", "")
    cached_expiry_str = os.environ.get("CACHED_FILE_EXPIRY", "")
    cached_mime = os.environ.get("CACHED_FILE_MIME", "image/png")
    file_uri = None
    file_mime = cached_mime or "image/png"
    
    if cached_uri and cached_expiry_str:
        try:
            expiry = datetime.datetime.fromisoformat(cached_expiry_str)
            now = datetime.datetime.now(datetime.timezone.utc)
            if now < expiry:
                file_uri = cached_uri
                print(f"[Cloud] Reusing cached Files API URI: {file_uri} (expires {expiry.isoformat()})", file=sys.stderr)
        except Exception:
            pass

    if not file_uri:
        print(f"[Cloud] Staging base asset '{ref_image_path}' to Google File API...", file=sys.stderr)
        try:
            uploaded_file = client.files.upload(file=ref_image_path)
            file_uri = uploaded_file.uri
            file_mime = uploaded_file.mime_type
            # Compute expiry: 47 hours from now
            expiry_dt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=47)
            # Write cache info to stdout as a JSON sentinel line so the caller (worker) can persist it
            print(json.dumps({
                "__files_api_cache__": True,
                "uri": file_uri,
                "mime": file_mime,
                "expiry": expiry_dt.isoformat(),
            }), file=sys.stdout)
            print(f"[Cloud] Asset staged. URI: {file_uri}", file=sys.stderr)
        except Exception as e:
            raise RuntimeError(f"Failed to stage reference image. An image is strictly required: {e}")

    # Use the requested model
    model_id = os.environ.get("GEMINI_MODEL_ID", "gemini-3.1-flash-image")

    def worker_generate_variant(color: str, max_retries: int = 3) -> tuple[str, Optional[str]]:
        worker_prompt = prompt.replace("[COLOR]", color).replace("[color]", color) if prompt else f"Modify the color to be {color}. Keep all other details identical."
        
        contents = [{
            "role": "user",
            "parts": [
                {"text": worker_prompt},
                {"file_data": {"file_uri": file_uri, "mime_type": file_mime}}
            ]
        }]

        for attempt in range(max_retries):
            try:
                print(f"   -> [Thread {color}] Requesting Gemini variant (Attempt {attempt + 1})...", file=sys.stderr)
                
                # Configure modalities for image generation
                config_kwargs = {}
                if "image" in model_id.lower() or "preview" in model_id.lower():
                    config_kwargs["response_modalities"] = ["IMAGE"]
                
                response = client.models.generate_content(
                    model=model_id,
                    contents=contents,
                    config=config_kwargs
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
        # Only delete the uploaded file if we actually uploaded it this run
        # (don't delete cached files — they are shared across runs until expiry)
        if uploaded_file:
            print("[Cloud] Purging temporary asset from Google servers...", file=sys.stderr)
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception as e:
                print(f"[Cloud] Warning: Could not cleanly delete cloud file: {e}", file=sys.stderr)
                
    # Add Python grid collage generation if running standalone (fallback if sharp is unavailable)
    if results and len(results) > 0:
        print("\n[System] Assembling the Production Grid...", file=sys.stderr)
        try:
            grid_cols = min(3, len(colors))
            grid_rows = (len(colors) + grid_cols - 1) // grid_cols
            grid_width = orig_width * grid_cols
            grid_height = orig_height * grid_rows
            
            grid_canvas = Image.new("RGBA", (grid_width, grid_height), (255, 255, 255, 255))
            
            for idx, color in enumerate(colors):
                img_path = results.get(color, ref_image_path)
                if not img_path or not os.path.isfile(img_path):
                    continue
                    
                img = Image.open(img_path)
                if img.size != (orig_width, orig_height):
                    img = img.resize((orig_width, orig_height), Image.Resampling.LANCZOS)
                    
                col = idx % grid_cols
                row = idx // grid_cols
                grid_canvas.paste(img, (col * orig_width, row * orig_height))
                
            grid_out_path = os.path.join(out_dir, f"production_grid.png")
            grid_canvas.save(grid_out_path)
            results["_grid"] = grid_out_path
            print(f"[System] Grid saved to {grid_out_path}", file=sys.stderr)
        except Exception as e:
            print(f"[Warning] Grid collage failed: {e}", file=sys.stderr)

    return results

# ---------------------------------------------------------------------------
# Strategy Router
# ---------------------------------------------------------------------------

GENERATION_STRATEGIES = {
    "gemini": generate_gemini_multithread,
}

def generate_veo_video(prompt: str, ref_image_path: str, out_path: str, api_key: str) -> str:
    """Generate product showcase video using Google Gemini Veo 3.1."""
    if not ref_image_path or not os.path.isfile(ref_image_path):
        raise ValueError("A reference image is required for Veo video generation.")

    resolved_key = api_key if (api_key and api_key != "none") else os.environ.get("GEMINI_API_KEY", os.environ.get("CHROMACRAFT_API_KEY", "none"))
    if resolved_key == "none":
        raise ValueError("Google Gemini API key required for Veo. Set GEMINI_API_KEY or CHROMACRAFT_API_KEY.")

    try:
        from google import genai
    except ImportError:
        raise ImportError("google-genai library is missing.")

    client = genai.Client(api_key=resolved_key)
    
    print(f"[Veo] Starting Veo 3.1 video generation with image: {ref_image_path}...", file=sys.stderr)
    
    # Load image for Veo
    import PIL.Image
    try:
        image = PIL.Image.open(ref_image_path)
    except Exception as e:
        raise RuntimeError(f"Failed to open reference image: {e}")

    try:
        operation = client.models.generate_videos(
            model="veo-3.1-generate-preview",
            prompt=prompt or "Cinematic panning shot of the product",
            image=image,
        )
        
        while not operation.done:
            print("[Veo] Waiting for video generation to complete...", file=sys.stderr)
            time.sleep(10)
            operation = client.operations.get(operation)
            
        if not operation.response.generated_videos:
            raise RuntimeError("Veo operation completed but returned no videos.")
            
        video_obj = operation.response.generated_videos[0]
        
        print(f"[Veo] Downloading video...", file=sys.stderr)
        client.files.download(file=video_obj.video)
        
        # Save to output path
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        video_obj.video.save(out_path)
        
        print(f"[Veo] Video successfully saved to {out_path}", file=sys.stderr)
        return out_path
    except Exception as e:
        raise RuntimeError(f"Veo video generation failed: {e}")
# ---------------------------------------------------------------------------
# TASKS ROUTING
# ---------------------------------------------------------------------------

def task_generate(args: argparse.Namespace, json_mode: bool) -> int:
    colors = parse_colors(args.colors)
    if not colors:
        _emit_error("--colors must specify at least one color name", json_mode)
        return 1

    os.makedirs(args.outDir, exist_ok=True)
    strategy = (args.strategy or "gemini").lower()
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

    if strategy != "gemini":
        _emit_error(f"Strategy '{strategy}' is not supported. ChromaCraft-AI is now Gemini-only.", json_mode)
        return 1

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
        if "_grid" in results:
            _emit_success(results["_grid"], f"type=grid,strategy={strategy}", json_mode)
    except Exception as exc:
        _emit_error(str(exc), json_mode, context=f"strategy={strategy}")
    return 0


def task_video(args: argparse.Namespace, json_mode: bool) -> int:
    """Generate product showcase video using Google Gemini Veo."""
    ref = getattr(args, "refImage", None)
    prefix = getattr(args, "prefix", "product")
    strategy = getattr(args, "strategy", "gemini").lower()
    
    out_video_path = os.path.join(args.outDir, f"{prefix}_showcase.mp4")

    if not ref or not os.path.isfile(ref):
        _emit_error("A reference image is strictly required for Gemini Veo video generation.", json_mode, context="strategy=veo")
        return 1

    try:
        prompt = getattr(args, "prompt", "Cinematic product showcase panning shot")
        path = generate_veo_video(prompt, ref, out_video_path, args.apiKey)
        _emit_success(path, "type=video,strategy=veo", json_mode)
        return 0
    except Exception as exc:
        _emit_error(str(exc), json_mode, context="strategy=veo")



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
    p.add_argument("--task", choices=["generate", "video", "lifestyle"], default="generate")
    p.add_argument("--jsonMode", action="store_true")
    p.add_argument("--jobId", default="0")
    p.add_argument("--prompt", default="")
    p.add_argument("--provider", default="gemini")
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

    # Default to gemini when running CLI manually
    p.add_argument("--strategy", default="gemini",
                   choices=["gemini"])
    p.add_argument("--denoiseStrength", type=float, default=0.4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--preservationStrength", type=float, default=0.7)
    return p


def main() -> int:
    args = build_parser().parse_args()
    dispatch = {
        "generate": task_generate,
        "video": task_video,
        "lifestyle": task_lifestyle,
    }
    return dispatch[args.task](args, args.jsonMode)


if __name__ == "__main__":
    sys.exit(main())