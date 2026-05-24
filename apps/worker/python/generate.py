#!/usr/bin/env python3
"""
ChromaCraft Image Generation Tool — JSON-mode entry point.

Usage (legacy, backwards-compatible):
    python generate.py --jobId 1 --prompt "..." --provider mock \
        --apiKey none --outDir /tmp/out --colors "White,Black"

Usage (ReAct / JSON-mode, used by AgentController):
    python generate.py --task generate --jobId 1 --prompt "..." \
        --provider mock --apiKey none --outDir /tmp/out \
        --colors "White" --jsonMode [--refImage /path/to/ref.png]

    python generate.py --task rotate --inputPath /path/to/img.png \
        --degrees 90 --outputPath /path/to/out.png --jsonMode

    python generate.py --task composite --foreground /path/a.png \
        --background /path/b.png --outputPath /path/out.png --jsonMode

Exit codes:
    0 — success
    1 — error

In --jsonMode the LAST line of stdout is always a JSON object:
    {"status": "success", "path": "...", "metadata": "..."}
    {"status": "error",   "reason": "..."}
"""

import argparse
import base64
import json
import os
import re
import sys
from typing import Optional

import requests
from PIL import Image, ImageChops, ImageDraw


# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------

def color_to_slug(color: str) -> str:
    slug = color.strip().replace(" ", "_")
    return re.sub(r"[^A-Za-z0-9_]", "", slug)


def parse_colors(colors_arg: str) -> list[str]:
    return [c.strip() for c in colors_arg.split(",") if c.strip()]


def raw_filename(color: str) -> str:
    return f"raw_{color_to_slug(color)}.png"


def get_color_rgb(color_name: str) -> tuple[int, int, int]:
    color_map = {
        "white": (245, 245, 245),
        "black": (20, 20, 20),
        "blue": (30, 90, 220),
        "red": (220, 25, 25),
        "green": (25, 160, 45),
        "brown": (110, 70, 35),
        "silver": (180, 180, 180),
        "yellow": (240, 210, 15),
        "cream": (240, 230, 205),
        "pink": (245, 160, 185),
        "dark_blue": (10, 25, 100),
        "orange": (245, 125, 5),
        "purple": (128, 0, 128),
        "gold": (255, 215, 0),
        "teal": (0, 128, 128),
        "lime": (0, 255, 0),
        "cyan": (0, 255, 255),
        "magenta": (255, 0, 255),
        "navy": (0, 0, 128),
        "maroon": (128, 0, 0),
        "olive": (128, 128, 0),
        "gray": (128, 128, 128),
        "grey": (128, 128, 128),
        "charcoal": (54, 69, 79),
        "bronze": (205, 127, 50),
        "beige": (245, 245, 220),
    }
    name_clean = color_name.lower().strip().replace(" ", "_")

    hex_str = name_clean.lstrip("#")
    if len(hex_str) == 6 and all(c in "0123456789abcdef" for c in hex_str):
        try:
            return (int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))
        except ValueError:
            pass
    if len(hex_str) == 3 and all(c in "0123456789abcdef" for c in hex_str):
        try:
            return (int(hex_str[0] * 2, 16), int(hex_str[1] * 2, 16), int(hex_str[2] * 2, 16))
        except ValueError:
            pass

    return color_map.get(name_clean, (128, 128, 128))


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def draw_car_silhouette(draw: ImageDraw.ImageDraw, color_rgb: tuple[int, int, int], width: int, height: int) -> None:
    cx = width // 2
    cy = height // 2 + 30
    wheel_y = cy + 40
    wheel_r = 35
    draw.line([(50, wheel_y + wheel_r), (width - 50, wheel_y + wheel_r)], fill=(100, 100, 100), width=4)
    wheel1_x = cx - 150
    wheel2_x = cx + 150
    draw.ellipse([cx - 250, wheel_y + wheel_r - 8, cx + 250, wheel_y + wheel_r + 4], fill=(30, 30, 30))
    body_points = [
        (cx - 240, cy + 20), (cx - 180, cy - 20), (cx - 100, cy - 60),
        (cx + 80, cy - 60), (cx + 160, cy - 10), (cx + 220, cy + 10),
        (cx + 230, cy + 40), (cx - 240, cy + 40),
    ]
    draw.polygon(body_points, fill=color_rgb, outline=(255, 255, 255), width=2)
    cabin_points = [
        (cx - 160, cy - 15), (cx - 95, cy - 52), (cx + 70, cy - 52),
        (cx + 140, cy - 10), (cx - 160, cy - 15),
    ]
    draw.polygon(cabin_points, fill=(40, 40, 50), outline=(255, 255, 255), width=2)
    draw.line([(cx - 10, cy - 52), (cx - 10, cy - 12)], fill=(255, 255, 255), width=2)
    draw.polygon([(cx - 240, cy + 20), (cx - 220, cy + 20), (cx - 225, cy + 30), (cx - 240, cy + 30)], fill=(255, 235, 100))
    draw.polygon([(cx + 220, cy + 10), (cx + 230, cy + 15), (cx + 230, cy + 25), (cx + 215, cy + 20)], fill=(255, 50, 50))
    for wx in [wheel1_x, wheel2_x]:
        draw.ellipse([wx - wheel_r, wheel_y - wheel_r, wx + wheel_r, wheel_y + wheel_r], fill=(30, 30, 30), outline=(80, 80, 80), width=3)
        hub_r = 15
        draw.ellipse([wx - hub_r, wheel_y - hub_r, wx + hub_r, wheel_y + hub_r], fill=(200, 200, 200), outline=(100, 100, 100), width=2)


# ---------------------------------------------------------------------------
# Generation backends
# ---------------------------------------------------------------------------

def generate_mock_image(job_id: str, prompt: str, color: str, out_dir: str, provider_label: str = "MOCK AI") -> str:
    width, height = 800, 800
    color_rgb = get_color_rgb(color)
    is_light = color.lower().strip() in ["white", "silver", "cream", "yellow", "pink"]
    color1 = (60, 65, 75) if is_light else (240, 242, 245)
    color2 = (30, 35, 45) if is_light else (190, 195, 200)
    text_color = (255, 255, 255) if is_light else (30, 30, 30)
    accent_color = (255, 200, 80) if is_light else (10, 25, 100)

    img = Image.new("RGB", (width, height), color=color1)
    draw = ImageDraw.Draw(img)
    for y in range(height):
        r = int(color1[0] + (color2[0] - color1[0]) * (y / height))
        g = int(color1[1] + (color2[1] - color1[1]) * (y / height))
        b = int(color1[2] + (color2[2] - color1[2]) * (y / height))
        for x in range(width):
            draw.point((x, y), fill=(r, g, b))

    draw_car_silhouette(draw, color_rgb, width, height)

    model_match = re.search(r"\[([^\]]+)\]", prompt)
    model_name = model_match.group(1) if model_match else "Vehicle"
    draw.text((40, 40), f"MODEL: {model_name.upper()}", fill=accent_color)
    draw.text((40, 60), f"COLOR FINISH: {color.upper()}", fill=text_color)
    draw.text((40, height - 80), f"Job #{job_id} | Provider: {provider_label}\nPrompt: {prompt[:80]}...", fill=text_color)
    draw.rectangle([0, 0, width - 1, height - 1], outline=accent_color, width=8)

    out_path = os.path.join(out_dir, raw_filename(color))
    img.save(out_path, "PNG")
    return out_path


def apply_color_tint(ref_path: str, color_name: str, out_path: str) -> str:
    img = Image.open(ref_path).convert("RGBA")
    color_rgb = get_color_rgb(color_name)
    color_layer = Image.new("RGBA", img.size, color=(color_rgb[0], color_rgb[1], color_rgb[2], 255))
    tinted = ImageChops.multiply(img, color_layer)
    blended = Image.blend(img, tinted, 0.55)
    gray = img.convert("L")
    mask = gray.point(lambda x: 255 if x < 248 else 0, "1")
    r, g, b, a = img.split()
    combined_mask = ImageChops.multiply(a, mask.convert("L"))
    final_img = Image.composite(blended, img, combined_mask)
    final_img.save(out_path, "PNG")
    return out_path


def generate_openai_image(prompt: str, color: str, api_key: str, out_dir: str) -> str:
    color_prompt = f"{prompt}. Vehicle exterior color: {color}."
    response = requests.post(
        "https://api.openai.com/v1/images/generations",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": "dall-e-3", "prompt": color_prompt, "n": 1, "size": "1024x1024"},
        timeout=60,
    )
    response.raise_for_status()
    img_url = response.json()["data"][0]["url"]
    img_data = requests.get(img_url, timeout=30).content
    out_path = os.path.join(out_dir, raw_filename(color))
    with open(out_path, "wb") as f:
        f.write(img_data)
    return out_path


def generate_stability_image(prompt: str, color: str, api_key: str, out_dir: str) -> str:
    color_prompt = f"{prompt}. Vehicle exterior color: {color}."
    response = requests.post(
        "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json"},
        json={
            "text_prompts": [{"text": color_prompt, "weight": 1}],
            "cfg_scale": 7, "height": 1024, "width": 1024, "samples": 1, "steps": 30,
        },
        timeout=60,
    )
    response.raise_for_status()
    img_b64 = response.json()["artifacts"][0]["base64"]
    img_data = base64.b64decode(img_b64)
    out_path = os.path.join(out_dir, raw_filename(color))
    with open(out_path, "wb") as f:
        f.write(img_data)
    return out_path


def call_groq_api(prompt: str, color: str, api_key: str) -> str:
    response = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "llama3-8b-8192",
            "messages": [
                {"role": "system", "content": (
                    "You are an expert prompt engineer for text-to-image AI generators. "
                    "Expand and enhance the user's base image prompt to describe a stunning, professional automotive catalog photo. "
                    "Explicitly specify the exterior paint finish color. Provide ONLY the enhanced prompt string."
                )},
                {"role": "user", "content": f"Base prompt: {prompt}. Paint color: {color}."},
            ],
            "temperature": 0.7,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip().strip('"')


# ---------------------------------------------------------------------------
# Task: generate (single color, JSON output)
# ---------------------------------------------------------------------------

def task_generate(args: argparse.Namespace, json_mode: bool) -> int:
    colors = parse_colors(args.colors)
    if not colors:
        _output_error("--colors must contain at least one color name", json_mode)
        return 1

    os.makedirs(args.outDir, exist_ok=True)
    provider_lower = args.provider.lower()
    results = []

    for color in colors:
        try:
            color_prompt = re.sub(r"\[color\]", color, args.prompt, flags=re.IGNORECASE)

            if args.refImage and os.path.exists(args.refImage):
                out_path = os.path.join(args.outDir, raw_filename(color))
                apply_color_tint(args.refImage, color, out_path)
            elif not args.apiKey or args.apiKey == "none" or provider_lower == "mock":
                out_path = generate_mock_image(args.jobId, color_prompt, color, args.outDir)
            elif "openai" in provider_lower:
                out_path = generate_openai_image(color_prompt, color, args.apiKey, args.outDir)
            elif "stability" in provider_lower:
                out_path = generate_stability_image(color_prompt, color, args.apiKey, args.outDir)
            elif "groq" in provider_lower:
                try:
                    enhanced = call_groq_api(color_prompt, color, args.apiKey)
                except Exception as e:
                    print(f"Groq API fallback: {e}", file=sys.stderr)
                    enhanced = f"{color_prompt}. Vehicle exterior color: {color}."
                out_path = generate_mock_image(args.jobId, enhanced, color, args.outDir, "GROQ AI (Llama-3)")
            else:
                out_path = generate_mock_image(args.jobId, color_prompt, color, args.outDir)

            results.append({"color": color, "path": out_path, "status": "success"})
            if json_mode:
                # Emit one JSON line per color for streaming consumption by AgentController
                print(json.dumps({"status": "success", "path": out_path, "metadata": f"color={color}"}), flush=True)
            else:
                print(f"Generated variant: {out_path}")

        except Exception as exc:
            err_msg = str(exc)
            results.append({"color": color, "status": "error", "reason": err_msg})
            if json_mode:
                print(json.dumps({"status": "error", "reason": err_msg}), flush=True)
            else:
                print(f"Error for color '{color}': {err_msg}", file=sys.stderr)
            # Fallback: generate mock so the pipeline isn't fully blocked
            try:
                fallback_path = generate_mock_image(args.jobId, args.prompt, color, args.outDir)
                if json_mode:
                    print(json.dumps({"status": "success", "path": fallback_path, "metadata": f"color={color};fallback=true"}), flush=True)
            except Exception:
                pass

    return 0


# ---------------------------------------------------------------------------
# Task: rotate
# ---------------------------------------------------------------------------

def task_rotate(args: argparse.Namespace, json_mode: bool) -> int:
    if not args.inputPath or not args.outputPath:
        _output_error("--inputPath and --outputPath are required for rotate task", json_mode)
        return 1
    degrees = int(getattr(args, "degrees", 90))
    try:
        img = Image.open(args.inputPath)
        rotated = img.rotate(-degrees, expand=True)
        os.makedirs(os.path.dirname(args.outputPath) or ".", exist_ok=True)
        rotated.save(args.outputPath, "PNG")
        if json_mode:
            print(json.dumps({"status": "success", "path": args.outputPath, "metadata": f"degrees={degrees}"}), flush=True)
        else:
            print(f"Rotated image saved to: {args.outputPath}")
        return 0
    except Exception as exc:
        _output_error(str(exc), json_mode)
        return 1


# ---------------------------------------------------------------------------
# Task: composite
# ---------------------------------------------------------------------------

def task_composite(args: argparse.Namespace, json_mode: bool) -> int:
    if not args.foreground or not args.background or not args.outputPath:
        _output_error("--foreground, --background, and --outputPath are required for composite task", json_mode)
        return 1
    try:
        fg = Image.open(args.foreground).convert("RGBA")
        bg = Image.open(args.background).convert("RGBA").resize(fg.size, Image.Resampling.LANCZOS)
        composite = Image.alpha_composite(bg, fg)
        os.makedirs(os.path.dirname(args.outputPath) or ".", exist_ok=True)
        composite.save(args.outputPath, "PNG")
        if json_mode:
            print(json.dumps({"status": "success", "path": args.outputPath, "metadata": "composite"}), flush=True)
        else:
            print(f"Composite image saved to: {args.outputPath}")
        return 0
    except Exception as exc:
        _output_error(str(exc), json_mode)
        return 1


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _output_error(reason: str, json_mode: bool) -> None:
    if json_mode:
        print(json.dumps({"status": "error", "reason": reason}), flush=True)
    else:
        print(f"Error: {reason}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Argument parser & main
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ChromaCraft Image Generation Tool")
    # Task dispatch (ReAct mode)
    parser.add_argument("--task", choices=["generate", "rotate", "composite"], default="generate",
                        help="Tool to execute (default: generate)")
    parser.add_argument("--jsonMode", action="store_true",
                        help="Emit results as JSON lines on stdout")

    # generate task args
    parser.add_argument("--jobId", default="0", help="Job identifier")
    parser.add_argument("--prompt", default="", help="Prompt text")
    parser.add_argument("--provider", default="mock", help="AI Provider name")
    parser.add_argument("--apiKey", default="none", help="Provider API Key")
    parser.add_argument("--outDir", default=".", help="Output directory path")
    parser.add_argument("--colors", default="", help="Comma-separated color names")
    parser.add_argument("--refImage", default=None, help="Path to reference uploaded image")

    # rotate task args
    parser.add_argument("--inputPath", default=None, help="Input image path (rotate/composite)")
    parser.add_argument("--degrees", type=int, default=90, help="Rotation degrees (rotate)")

    # composite task args
    parser.add_argument("--foreground", default=None, help="Foreground PNG path (composite)")
    parser.add_argument("--background", default=None, help="Background PNG path (composite)")
    parser.add_argument("--outputPath", default=None, help="Output path (rotate/composite)")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    json_mode: bool = args.jsonMode

    if args.task == "generate":
        return task_generate(args, json_mode)
    elif args.task == "rotate":
        return task_rotate(args, json_mode)
    elif args.task == "composite":
        return task_composite(args, json_mode)
    else:
        _output_error(f"Unknown task: {args.task}", json_mode)
        return 1


if __name__ == "__main__":
    sys.exit(main())
