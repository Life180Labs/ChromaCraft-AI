#!/usr/bin/env python3
"""
ChromaCraft Image Generation Tool — JSON-mode entry point.

Supports:
  - task generate  : Multi-color catalog variant generation (mock / OpenAI / Stability / Groq)
  - task recolor   : Recolor an uploaded reference image to target colors (color transfer)
  - task spin360   : Generate 360° turntable frames from a reference image
  - task video     : Stitch 360° frames into an animated GIF / MP4 with ffmpeg
  - task composite : Alpha-composite foreground over background
  - task rotate    : Rotate an image by N degrees

Exit codes: 0 = success, 1 = error

JSON-mode (--jsonMode):
    Each color / task emits one JSON line to stdout:
    {"status": "success", "path": "...", "metadata": "..."}
    {"status": "error",   "reason": "..."}
"""

from __future__ import annotations

import argparse
import base64
import colorsys
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Optional

import requests
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

# ---------------------------------------------------------------------------
# Slug / filename helpers
# ---------------------------------------------------------------------------

def color_to_slug(color: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", color.strip().replace(" ", "_"))


def parse_colors(colors_arg: str) -> list[str]:
    return [c.strip() for c in colors_arg.split(",") if c.strip()]


def raw_filename(color: str) -> str:
    return f"raw_{color_to_slug(color)}.png"


# ---------------------------------------------------------------------------
# Color name → RGB
# ---------------------------------------------------------------------------

COLOR_MAP: dict[str, tuple[int, int, int]] = {
    "white": (245, 245, 245),
    "black": (20, 20, 20),
    "blue": (30, 90, 220),
    "red": (210, 25, 25),
    "green": (25, 150, 45),
    "brown": (110, 70, 35),
    "silver": (192, 192, 192),
    "yellow": (240, 210, 15),
    "cream": (240, 230, 205),
    "pink": (240, 105, 160),
    "dark_blue": (10, 25, 110),
    "orange": (240, 120, 5),
    "purple": (130, 0, 130),
    "gold": (218, 165, 32),
    "teal": (0, 130, 128),
    "navy": (0, 0, 128),
    "maroon": (128, 0, 0),
    "gray": (130, 130, 130),
    "grey": (130, 130, 130),
    "charcoal": (54, 69, 79),
    "bronze": (205, 127, 50),
    "beige": (245, 245, 220),
    "lime": (50, 205, 50),
    "cyan": (0, 200, 210),
}


def name_to_rgb(color_name: str) -> tuple[int, int, int]:
    key = color_to_slug(color_name).lower()
    if key in COLOR_MAP:
        return COLOR_MAP[key]
    # Hex fallback
    hex_str = key.lstrip("#")
    if len(hex_str) == 6:
        try:
            return (int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))
        except ValueError:
            pass
    if len(hex_str) == 3:
        try:
            return (int(hex_str[0] * 2, 16), int(hex_str[1] * 2, 16), int(hex_str[2] * 2, 16))
        except ValueError:
            pass
    return (128, 128, 128)


def rgb_to_hsl(r: int, g: int, b: int) -> tuple[float, float, float]:
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return h, s, l


def hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (int(r * 255), int(g * 255), int(b * 255))


# ---------------------------------------------------------------------------
# ── CORE: Intelligent color recoloring from a reference image ──────────────
#
# Strategy:
#   1. Isolate the "body" pixels of the product using rembg (remove background).
#   2. Compute average HSL of non-background, non-black pixels → "source color".
#   3. Map every body pixel: keep luminance/saturation structure, shift hue to
#      target hue, scale saturation and luminance toward the target palette.
#   4. Composite back onto a clean white studio background.
#   5. Paste the original glass/chrome highlights back on top (high-L pixels).
# ---------------------------------------------------------------------------

def _rembg_remove(img: Image.Image) -> Image.Image:
    """Remove background using rembg if available, else return as RGBA."""
    try:
        from rembg import remove as rembg_remove
        buf_in = BytesIO()
        img.save(buf_in, format="PNG")
        buf_out = BytesIO(rembg_remove(buf_in.getvalue()))
        return Image.open(buf_out).convert("RGBA")
    except Exception:
        # Graceful fallback: just convert to RGBA
        return img.convert("RGBA")


def recolor_reference(
    ref_path: str,
    target_color_name: str,
    out_path: str,
    bg_color: tuple[int, int, int] = (255, 255, 255),
    image_size: tuple[int, int] = (800, 600),
) -> str:
    """
    Recolor a reference product image to a target color using HSL hue-shifting.
    The subject is separated from the background, recolored, then placed on a
    clean studio background.
    """
    target_rgb = name_to_rgb(target_color_name)
    t_h, t_s, t_l = rgb_to_hsl(*target_rgb)

    # Load original image and scale to target size
    src = Image.open(ref_path).convert("RGBA")
    src.thumbnail(image_size, Image.Resampling.LANCZOS)
    
    # Create base canvas with the original image centered
    base_canvas = Image.new("RGBA", image_size, (255, 255, 255, 255))
    offset = ((image_size[0] - src.width) // 2, (image_size[1] - src.height) // 2)
    base_canvas.paste(src, offset, src)

    # Remove background to isolate the car body
    fg = _rembg_remove(base_canvas)
    canvas = fg

    r_arr, g_arr, b_arr, a_arr = canvas.split()
    r_data = list(r_arr.getdata())
    g_data = list(g_arr.getdata())
    b_data = list(b_arr.getdata())
    a_data = list(a_arr.getdata())

    # Detect achromatic (silver / white / black) targets
    is_achromatic = t_s < 0.08 or target_color_name.lower().strip() in ("silver", "white", "black", "gray", "grey", "charcoal")

    new_r, new_g, new_b = [], [], []
    for i, (r, g, b, a) in enumerate(zip(r_data, g_data, b_data, a_data)):
        if a < 30:  # fully transparent
            new_r.append(r); new_g.append(g); new_b.append(b)
            continue

        h, s, l = rgb_to_hsl(r, g, b)

        # Preserve glass / chrome: very high luminance or very low saturation bright pixels
        if l > 0.88 or (l > 0.75 and s < 0.10):
            new_r.append(r); new_g.append(g); new_b.append(b)
            continue

        # Preserve very dark shadow pixels (deep blacks) unchanged
        if l < 0.08:
            new_r.append(r); new_g.append(g); new_b.append(b)
            continue

        if is_achromatic:
            # For metallic / neutral targets: desaturate and scale luminance
            new_s = s * 0.15  # nearly achromatic
            if target_color_name.lower().strip() == "silver":
                new_l = 0.45 + l * 0.45   # mid-bright
            elif target_color_name.lower().strip() in ("white",):
                new_l = 0.75 + l * 0.22
            elif target_color_name.lower().strip() in ("black", "charcoal"):
                new_l = l * 0.35
            else:
                new_l = t_l * 0.6 + l * 0.4
            nr, ng, nb = hsl_to_rgb(t_h, new_s, new_l)
        else:
            # Chromatic target: shift hue fully, blend saturation, preserve luminance structure
            new_h = t_h
            new_s = t_s * 0.6 + s * 0.4
            # Keep relative luminance but center around target luminance
            new_l = t_l * 0.55 + l * 0.45
            nr, ng, nb = hsl_to_rgb(new_h, new_s, new_l)

        new_r.append(max(0, min(255, nr)))
        new_g.append(max(0, min(255, ng)))
        new_b.append(max(0, min(255, nb)))

    result_r = Image.new("L", image_size); result_r.putdata(new_r)
    result_g = Image.new("L", image_size); result_g.putdata(new_g)
    result_b = Image.new("L", image_size); result_b.putdata(new_b)
    result_a = a_arr

    recolored = Image.merge("RGBA", (result_r, result_g, result_b, result_a))

    # Add subtle drop-shadow for depth
    shadow = recolored.filter(ImageFilter.GaussianBlur(radius=12))
    shadow = ImageOps.colorize(shadow.convert("L"), black=(0, 0, 0), white=(200, 200, 210))
    shadow_rgba = shadow.convert("RGBA")
    s_data = list(shadow_rgba.getdata())
    a_shadow = [int(a * 0.25) for _, _, _, a in s_data]  # 25% opacity shadow
    shadow_rgba.putalpha(Image.new("L", image_size, 0))
    a_layer = Image.new("L", image_size)
    a_layer.putdata(a_shadow)
    shadow_rgba.putalpha(a_layer)

    # Studio background
    background = _make_studio_background(image_size, bg_color=(255, 255, 255))
    background.paste(shadow_rgba, (4, 8), shadow_rgba)  # shadow offset
    background.paste(recolored, (0, 0), recolored)

    # Ground reflection (subtle)
    reflection = recolored.transpose(Image.FLIP_TOP_BOTTOM)
    fade = Image.new("L", image_size, 0)
    fade_draw = ImageDraw.Draw(fade)
    for y_px in range(image_size[1] // 3):
        alpha = int(80 * (1 - y_px / (image_size[1] / 3)))
        fade_draw.line([(0, y_px), (image_size[0], y_px)], fill=alpha)
    reflection.putalpha(fade)
    background.paste(reflection, (0, image_size[1] - image_size[1] // 3), reflection)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    background.save(out_path, "PNG")
    return out_path


def _make_studio_background(
    size: tuple[int, int],
    base_color: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    """Create a gradient studio backdrop (bright center, slight vignette)."""
    bg = Image.new("RGB", size, base_color)
    draw = ImageDraw.Draw(bg)
    cx, cy = size[0] // 2, size[1] // 2
    max_r = math.sqrt(cx ** 2 + cy ** 2)
    # Radial gradient: white center → light grey edges
    for y in range(size[1]):
        for x in range(0, size[0], 4):  # sample every 4px for speed
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            t = min(dist / max_r, 1.0)
            shade = int(255 - t * 30)  # 255 → 225
            color = (shade, shade, shade + 5)
            draw.line([(x, y), (min(x + 3, size[0] - 1), y)], fill=color)
    return bg


# ---------------------------------------------------------------------------
# Mock generation (no API key) — improved realistic placeholder
# ---------------------------------------------------------------------------

def generate_mock_image(
    job_id: str,
    prompt: str,
    color: str,
    out_dir: str,
    provider_label: str = "Mock",
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
) -> str:
    """
    If a reference image is provided, recolor it.
    Otherwise, draw a detailed product placeholder with correct color.
    """
    out_path = os.path.join(out_dir, raw_filename(color))

    if ref_image_path and os.path.isfile(ref_image_path):
        try:
            res_path = recolor_reference(ref_image_path, color, out_path, image_size=image_size)
            # Overlay the prompt onto the recolored image so the user can verify their prompt was used
            img = Image.open(res_path).convert("RGB")
            draw = ImageDraw.Draw(img)
            draw.text((18, 14), f"ChromaCraft AI  ·  {color.upper()}", fill=(30, 30, 30))
            draw.text((18, 30), f"Prompt: {prompt[:100]}...", fill=(60, 60, 60))
            draw.text((18, image_size[1] - 26), f"Job #{job_id}  |  {provider_label}", fill=(130, 130, 130))
            img.save(res_path, "PNG")
            return res_path
        except Exception as exc:
            print(f"[warn] recolor failed ({exc}), falling back to drawn mock", file=sys.stderr)

    # ── Drawn mock ──
    color_rgb = name_to_rgb(color)
    bg_dark = tuple(max(0, c - 40) for c in color_rgb)
    img = Image.new("RGB", image_size, (240, 240, 242))
    draw = ImageDraw.Draw(img)

    # Background gradient
    for y in range(image_size[1]):
        t = y / image_size[1]
        r = int(240 - t * 30)
        g = int(240 - t * 28)
        b = int(242 - t * 25)
        draw.line([(0, y), (image_size[0], y)], fill=(r, g, b))

    # Ground line
    gy = int(image_size[1] * 0.72)
    for y in range(gy, image_size[1]):
        t = (y - gy) / (image_size[1] - gy)
        shade = int(210 - t * 30)
        draw.line([(0, y), (image_size[0], y)], fill=(shade, shade, shade + 5))

    # Car body
    cx, cy_body = image_size[0] // 2, int(image_size[1] * 0.55)
    body = [
        (cx - 290, cy_body + 35), (cx - 230, cy_body - 25),
        (cx - 140, cy_body - 75), (cx + 100, cy_body - 75),
        (cx + 200, cy_body - 20), (cx + 270, cy_body + 20),
        (cx + 285, cy_body + 55), (cx - 290, cy_body + 55),
    ]
    draw.polygon(body, fill=color_rgb, outline=tuple(max(0, c - 60) for c in color_rgb), width=2)

    # Cabin
    cabin = [
        (cx - 200, cy_body - 20), (cx - 130, cy_body - 68),
        (cx + 85, cy_body - 68), (cx + 170, cy_body - 18),
        (cx - 200, cy_body - 20),
    ]
    draw.polygon(cabin, fill=tuple(min(255, c + 20) for c in color_rgb), outline=(200, 210, 220), width=1)

    # Windows
    draw.polygon([
        (cx - 185, cy_body - 22), (cx - 120, cy_body - 60),
        (cx - 30, cy_body - 60), (cx - 30, cy_body - 22),
    ], fill=(100, 140, 180, 200), outline=(150, 180, 210))
    draw.polygon([
        (cx - 20, cy_body - 60), (cx + 80, cy_body - 60),
        (cx + 160, cy_body - 20), (cx - 20, cy_body - 20),
    ], fill=(100, 140, 180, 200), outline=(150, 180, 210))

    # Wheels
    w_r = 42
    for wx in [cx - 170, cx + 155]:
        wy = cy_body + 50
        # Tyre shadow
        draw.ellipse([wx - w_r - 3, wy - 5, wx + w_r + 3, wy + 12], fill=(60, 60, 60))
        # Tyre
        draw.ellipse([wx - w_r, wy - w_r, wx + w_r, wy + w_r], fill=(25, 25, 25))
        # Rim
        draw.ellipse([wx - 26, wy - 26, wx + 26, wy + 26], fill=(190, 195, 200), outline=(140, 145, 150))
        # Hub spokes
        for angle in range(0, 360, 60):
            rad = math.radians(angle)
            x1, y1 = wx + int(10 * math.cos(rad)), wy + int(10 * math.sin(rad))
            x2, y2 = wx + int(24 * math.cos(rad)), wy + int(24 * math.sin(rad))
            draw.line([(x1, y1), (x2, y2)], fill=(130, 135, 140), width=2)

    # Headlights / taillights
    draw.polygon([(cx - 285, cy_body + 10), (cx - 255, cy_body - 5),
                  (cx - 240, cy_body + 8), (cx - 275, cy_body + 25)],
                 fill=(255, 240, 180))
    draw.polygon([(cx + 255, cy_body + 5), (cx + 278, cy_body + 10),
                  (cx + 272, cy_body + 30), (cx + 248, cy_body + 25)],
                 fill=(255, 60, 60))

    # Label
    label_color = (30, 30, 30) if sum(color_rgb) > 400 else (220, 220, 220)
    draw.text((18, 14), f"ChromaCraft AI  ·  {color.upper()}", fill=label_color)
    draw.text((18, image_size[1] - 26), f"Job #{job_id}  |  {provider_label}", fill=(130, 130, 130))

    os.makedirs(out_dir, exist_ok=True)
    img.save(out_path, "PNG")
    return out_path


# ---------------------------------------------------------------------------
# OpenAI DALL·E 3 generation
# ---------------------------------------------------------------------------

def generate_openai_image(
    prompt: str, color: str, api_key: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
) -> str:
    """
    Generate via DALL·E 3. If a ref image exists, use GPT-4o vision to get
    a detailed description first, then inject it into the generation prompt.
    """
    enhanced_prompt = _build_openai_prompt(prompt, color, api_key, ref_image_path)
    dalle_size = "1024x1024"  # DALL-E 3 supports: 1024x1024, 1792x1024, 1024x1792
    if image_size[0] > image_size[1]:
        dalle_size = "1792x1024"

    response = requests.post(
        "https://api.openai.com/v1/images/generations",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "dall-e-3",
            "prompt": enhanced_prompt,
            "n": 1,
            "size": dalle_size,
            "quality": "hd",
            "style": "natural",
        },
        timeout=90,
    )
    response.raise_for_status()
    img_url = response.json()["data"][0]["url"]
    img_data = requests.get(img_url, timeout=45).content

    # Resize to target dimensions
    raw_img = Image.open(BytesIO(img_data)).convert("RGBA")
    raw_img = raw_img.resize(image_size, Image.Resampling.LANCZOS)

    out_path = os.path.join(out_dir, raw_filename(color))
    os.makedirs(out_dir, exist_ok=True)
    raw_img.save(out_path, "PNG")
    return out_path


def _build_openai_prompt(
    base_prompt: str,
    color: str,
    api_key: str,
    ref_image_path: Optional[str],
) -> str:
    """Use GPT-4o vision to analyze reference image and build an enhanced prompt."""
    if not ref_image_path or not os.path.isfile(ref_image_path):
        color_prompt = re.sub(r"\[color\]", color, base_prompt, flags=re.IGNORECASE)
        return (
            f"{color_prompt}. "
            f"Vehicle exterior paint: {color}. "
            "Photorealistic automotive product catalog image. "
            "Studio white background. Front-right three-quarter view. "
            "Professional lighting with soft shadows. No text or watermarks."
        )

    try:
        with open(ref_image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()
        ext = Path(ref_image_path).suffix.lstrip(".").lower()
        mime = f"image/{ext}" if ext in ("jpg", "jpeg", "png", "webp") else "image/jpeg"

        vision_resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o",
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": (
                            "You are an expert automotive photographer. "
                            "Describe this product in detail for a text-to-image prompt: "
                            "exact make/model, body style, wheel design, grille shape, "
                            "headlight style, and any distinguishing features. "
                            "CRITICAL: Do NOT mention the current paint color of the vehicle. "
                            "Ignore the color entirely. Focus only on physical structure and features. "
                            "Keep the description under 100 words. Output only the description."
                        )},
                        {"type": "image_url", "image_url": {
                            "url": f"data:{mime};base64,{img_b64}", "detail": "high"
                        }},
                    ],
                }],
                "max_tokens": 200,
            },
            timeout=30,
        )
        vision_resp.raise_for_status()
        description = vision_resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        print(f"[warn] vision description failed: {exc}", file=sys.stderr)
        description = "the vehicle shown in the reference image"

    color_prompt = re.sub(r"\[color\]", color, base_prompt, flags=re.IGNORECASE)
    return (
        f"A photorealistic product catalog image of a {color.upper()} colored vehicle. "
        f"The vehicle's exterior paint MUST be exclusively {color.upper()}. "
        f"Exact model: {description}. "
        f"{color_prompt}. "
        "Professional automotive catalog photograph. "
        "Pure white studio background. Front-right three-quarter view. "
        "Soft diffused lighting, subtle reflections. No text, no people."
    )


# ---------------------------------------------------------------------------
# Stability AI generation
# ---------------------------------------------------------------------------

def generate_stability_image(
    prompt: str, color: str, api_key: str, out_dir: str,
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
) -> str:
    color_prompt = (
        f"A photorealistic product catalog image of a {color.upper()} colored vehicle. "
        f"The vehicle's exterior paint MUST be exclusively {color.upper()}. "
        f"{re.sub(r'[[]color[]]', color, prompt, flags=re.IGNORECASE)}. "
        "White background. Studio lighting."
    )

    # Use img2img if reference available
    if ref_image_path and os.path.isfile(ref_image_path):
        ref_img = Image.open(ref_image_path).convert("RGB").resize((1024, 1024))
        buf = BytesIO(); ref_img.save(buf, "PNG")
        response = requests.post(
            "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            files={"init_image": ("ref.png", buf.getvalue(), "image/png")},
            data={
                "text_prompts[0][text]": color_prompt,
                "text_prompts[0][weight]": "1",
                "text_prompts[1][text]": "watermark, text, blurry, low quality",
                "text_prompts[1][weight]": "-1",
                "image_strength": "0.10",
                "cfg_scale": "7",
                "samples": "1",
                "steps": "40",
            },
            timeout=90,
        )
    else:
        response = requests.post(
            "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json"},
            json={
                "text_prompts": [
                    {"text": color_prompt, "weight": 1},
                    {"text": "watermark, text, blurry, low quality, distorted", "weight": -1},
                ],
                "cfg_scale": 7, "height": 1024, "width": 1024, "samples": 1, "steps": 40,
            },
            timeout=90,
        )

    response.raise_for_status()
    img_b64 = response.json()["artifacts"][0]["base64"]
    raw_img = Image.open(BytesIO(base64.b64decode(img_b64))).convert("RGBA")
    raw_img = raw_img.resize(image_size, Image.Resampling.LANCZOS)

    out_path = os.path.join(out_dir, raw_filename(color))
    os.makedirs(out_dir, exist_ok=True)
    raw_img.save(out_path, "PNG")
    return out_path


# ---------------------------------------------------------------------------
# Groq → text-enhanced mock
# ---------------------------------------------------------------------------

def generate_groq_image(
    prompt: str, color: str, api_key: str, out_dir: str,
    job_id: str = "0",
    ref_image_path: Optional[str] = None,
    image_size: tuple[int, int] = (800, 600),
) -> str:
    """Use Groq LLM to enhance the prompt, then apply recoloring to ref image."""
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "llama3-8b-8192",
                "messages": [
                    {"role": "system", "content": (
                        "You are an automotive photography expert. "
                        "Expand the base prompt into a detailed DALL-E style prompt. "
                        "Specify the exact {color} paint finish, studio lighting, "
                        "background, and composition. Output ONLY the final prompt string."
                    )},
                    {"role": "user", "content": f"Base: {prompt}. Paint color: {color}."},
                ],
                "temperature": 0.5,
                "max_tokens": 200,
            },
            timeout=30,
        )
        resp.raise_for_status()
        enhanced = resp.json()["choices"][0]["message"]["content"].strip().strip('"')
    except Exception as exc:
        print(f"[warn] Groq API: {exc}", file=sys.stderr)
        enhanced = f"{prompt}. Vehicle paint color: {color}."

    raise ValueError("Groq is a text-only LLM and cannot generate images natively. Please use OpenAI (DALL-E) or Stability AI for true image generation, or provide a local Stable Diffusion endpoint.")


# ---------------------------------------------------------------------------
# 360° turntable spin generation
# ---------------------------------------------------------------------------

def generate_spin360(
    ref_path: str,
    out_dir: str,
    prefix: str,
    frames: int = 36,
    image_size: tuple[int, int] = (800, 600),
) -> list[str]:
    """
    Generate `frames` rotation frames of a product by perspective-warping
    a recolored reference image. Each frame simulates a 360/frames degree rotation.
    Returns list of output file paths.
    """
    os.makedirs(out_dir, exist_ok=True)

    # Load the reference (use rembg-isolated subject)
    try:
        from rembg import remove as rembg_remove
        with open(ref_path, "rb") as f:
            raw = f.read()
        subject = Image.open(BytesIO(rembg_remove(raw))).convert("RGBA")
    except Exception:
        subject = Image.open(ref_path).convert("RGBA")

    # Fit subject inside frame
    subject.thumbnail(image_size, Image.Resampling.LANCZOS)
    sw, sh = subject.size

    generated = []
    for i in range(frames):
        angle_deg = (360.0 / frames) * i
        angle_rad = math.radians(angle_deg)

        # Perspective compression: simulate looking from a different angle
        # At 0° = full width; at 90°/270° = minimal width (edge-on)
        compression = abs(math.cos(angle_rad))
        # Never go below 15% width (so we always see something)
        compression = max(0.15, compression)

        new_w = max(4, int(sw * compression))
        frame_img = subject.resize((new_w, sh), Image.Resampling.LANCZOS)

        # Darken/lighten to simulate lighting from the left
        brightness_factor = 0.55 + 0.45 * ((math.cos(angle_rad) + 1) / 2)
        enhancer = ImageEnhance.Brightness(frame_img)
        frame_img = enhancer.enhance(brightness_factor)

        # Flip horizontally for angles > 180 (back side)
        if 90 < angle_deg <= 270:
            frame_img = ImageOps.mirror(frame_img)

        # Create studio background and paste
        bg = _make_studio_background(image_size)
        bg = bg.convert("RGBA")
        px = (image_size[0] - new_w) // 2
        py = (image_size[1] - sh) // 2
        bg.paste(frame_img, (px, py), frame_img)

        # Ground reflection
        _add_ground_reflection(bg, frame_img, px, py, sh, image_size)

        out_path = os.path.join(out_dir, f"{prefix}_spin_{i:03d}.png")
        bg.convert("RGB").save(out_path, "PNG")
        generated.append(out_path)

    return generated


def _add_ground_reflection(
    canvas: Image.Image,
    subject: Image.Image,
    px: int, py: int, sh: int,
    canvas_size: tuple[int, int],
) -> None:
    refl = subject.transpose(Image.FLIP_TOP_BOTTOM)
    refl_h = min(sh // 3, canvas_size[1] - (py + sh))
    if refl_h <= 0:
        return
    refl = refl.crop((0, sh - refl_h, refl.width, sh))
    fade = Image.new("L", refl.size, 0)
    fade_draw = ImageDraw.Draw(fade)
    for y in range(refl_h):
        a = int(60 * (1 - y / refl_h))
        fade_draw.line([(0, y), (refl.width, y)], fill=a)
    refl.putalpha(fade)
    canvas.paste(refl, (px, py + sh), refl)


# ---------------------------------------------------------------------------
# Video generation from spin frames (GIF + optional MP4 via ffmpeg)
# ---------------------------------------------------------------------------

def generate_video_from_frames(
    frames_dir: str,
    output_path: str,
    prefix: str,
    fps: int = 12,
) -> str:
    """
    Stitch spin frames into an animated GIF. Also tries ffmpeg for MP4.
    Returns path to the primary output (MP4 if available, else GIF).
    """
    pattern = re.compile(rf"^{re.escape(prefix)}_spin_(\d{{3}})\.png$")
    frame_files = sorted(
        [f for f in os.listdir(frames_dir) if pattern.match(f)],
        key=lambda x: int(pattern.match(x).group(1)),
    )
    if not frame_files:
        raise FileNotFoundError(f"No spin frames found in {frames_dir} for prefix '{prefix}'")

    frames_imgs = [Image.open(os.path.join(frames_dir, f)).convert("RGB") for f in frame_files]

    # Animated GIF
    gif_path = output_path if output_path.endswith(".gif") else output_path.replace(".mp4", ".gif")
    os.makedirs(os.path.dirname(gif_path) or ".", exist_ok=True)
    frames_imgs[0].save(
        gif_path,
        save_all=True,
        append_images=frames_imgs[1:],
        duration=int(1000 / fps),
        loop=0,
        optimize=True,
    )

    # Try MP4 with ffmpeg
    mp4_path = gif_path.replace(".gif", ".mp4")
    try:
        tmp_pattern = os.path.join(frames_dir, f"{prefix}_spin_%03d.png")
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", tmp_pattern,
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-crf", "22",
                mp4_path,
            ],
            capture_output=True, timeout=120,
        )
        if result.returncode == 0:
            return mp4_path
    except Exception as exc:
        print(f"[warn] ffmpeg not available, using GIF: {exc}", file=sys.stderr)

    return gif_path


# ---------------------------------------------------------------------------
# Task dispatchers
# ---------------------------------------------------------------------------

def task_generate(args: argparse.Namespace, json_mode: bool) -> int:
    colors = parse_colors(args.colors)
    if not colors:
        _emit_error("--colors must specify at least one color name", json_mode)
        return 1

    os.makedirs(args.outDir, exist_ok=True)
    provider = args.provider.lower()
    w, h = _parse_size(getattr(args, "imageSize", "800x600"))

    for color in colors:
        try:
            color_prompt = re.sub(r"\[color\]", color, args.prompt, flags=re.IGNORECASE)
            out_path = _dispatch_generation(
                provider=provider,
                prompt=color_prompt,
                color=color,
                api_key=args.apiKey,
                out_dir=args.outDir,
                job_id=args.jobId,
                ref_image_path=getattr(args, "refImage", None),
                image_size=(w, h),
            )
            _emit_success(out_path, f"color={color}", json_mode)
        except Exception as exc:
            _emit_error(str(exc), json_mode, context=f"color={color}")
    return 0


def task_recolor(args: argparse.Namespace, json_mode: bool) -> int:
    """Recolor a reference image for each requested color."""
    if not args.refImage or not os.path.isfile(args.refImage):
        _emit_error("--refImage path required and must exist for recolor task", json_mode)
        return 1
    colors = parse_colors(args.colors)
    w, h = _parse_size(getattr(args, "imageSize", "800x600"))
    os.makedirs(args.outDir, exist_ok=True)
    for color in colors:
        try:
            out_path = os.path.join(args.outDir, raw_filename(color))
            recolor_reference(args.refImage, color, out_path, image_size=(w, h))
            _emit_success(out_path, f"color={color}", json_mode)
        except Exception as exc:
            _emit_error(str(exc), json_mode, context=f"color={color}")
    return 0


def task_spin360(args: argparse.Namespace, json_mode: bool) -> int:
    """Generate 360° spin frames from a reference image."""
    ref = getattr(args, "refImage", None) or getattr(args, "inputPath", None)
    if not ref or not os.path.isfile(ref):
        _emit_error("--refImage (or --inputPath) path required for spin360 task", json_mode)
        return 1
    frames = int(getattr(args, "frames", 36))
    prefix = getattr(args, "prefix", "product")
    w, h = _parse_size(getattr(args, "imageSize", "800x600"))
    os.makedirs(args.outDir, exist_ok=True)
    try:
        paths = generate_spin360(ref, args.outDir, prefix, frames, (w, h))
        for p in paths:
            _emit_success(p, f"frame={os.path.basename(p)}", json_mode)
    except Exception as exc:
        _emit_error(str(exc), json_mode)
        return 1
    return 0


def task_video(args: argparse.Namespace, json_mode: bool) -> int:
    """Stitch pre-generated spin frames into a video / GIF."""
    frames_dir = getattr(args, "framesDir", None) or args.outDir
    prefix = getattr(args, "prefix", "product")
    output_path = getattr(args, "outputPath", None) or os.path.join(frames_dir, f"{prefix}_360.mp4")
    fps = int(getattr(args, "fps", 12))
    try:
        final = generate_video_from_frames(frames_dir, output_path, prefix, fps)
        _emit_success(final, "type=video", json_mode)
    except Exception as exc:
        _emit_error(str(exc), json_mode)
        return 1
    return 0


def task_rotate(args: argparse.Namespace, json_mode: bool) -> int:
    if not args.inputPath or not args.outputPath:
        _emit_error("--inputPath and --outputPath are required for rotate task", json_mode)
        return 1
    degrees = int(getattr(args, "degrees", 90))
    try:
        img = Image.open(args.inputPath).rotate(-degrees, expand=True)
        os.makedirs(os.path.dirname(args.outputPath) or ".", exist_ok=True)
        img.save(args.outputPath, "PNG")
        _emit_success(args.outputPath, f"degrees={degrees}", json_mode)
    except Exception as exc:
        _emit_error(str(exc), json_mode)
        return 1
    return 0


def task_composite(args: argparse.Namespace, json_mode: bool) -> int:
    if not args.foreground or not args.background or not args.outputPath:
        _emit_error("--foreground, --background, --outputPath required for composite task", json_mode)
        return 1
    try:
        fg = Image.open(args.foreground).convert("RGBA")
        bg = Image.open(args.background).convert("RGBA").resize(fg.size, Image.Resampling.LANCZOS)
        result = Image.alpha_composite(bg, fg)
        os.makedirs(os.path.dirname(args.outputPath) or ".", exist_ok=True)
        result.save(args.outputPath, "PNG")
        _emit_success(args.outputPath, "type=composite", json_mode)
    except Exception as exc:
        _emit_error(str(exc), json_mode)
        return 1
    return 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dispatch_generation(
    provider: str, prompt: str, color: str, api_key: str,
    out_dir: str, job_id: str,
    ref_image_path: Optional[str], image_size: tuple[int, int],
) -> str:
    if "openai" in provider:
        return generate_openai_image(prompt, color, api_key, out_dir, ref_image_path, image_size)
    elif "stability" in provider:
        return generate_stability_image(prompt, color, api_key, out_dir, ref_image_path, image_size)
    elif "groq" in provider:
        return generate_groq_image(prompt, color, api_key, out_dir, job_id, ref_image_path, image_size)
    elif provider == "mock":
        raise ValueError("Mock provider is disabled by user request. Please configure a valid AI Image generation provider (OpenAI or Stability AI) with a valid API key.")
    
    raise ValueError(f"Unknown provider '{provider}' or provider not capable of generating images.")


def _parse_size(size_str: str) -> tuple[int, int]:
    try:
        w, h = size_str.lower().split("x")
        return (int(w), int(h))
    except Exception:
        return (800, 600)


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
# Argument parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Image Generation Tool")
    p.add_argument("--task",
                   choices=["generate", "recolor", "spin360", "video", "rotate", "composite"],
                   default="generate")
    p.add_argument("--jsonMode", action="store_true")

    # generate / recolor
    p.add_argument("--jobId", default="0")
    p.add_argument("--prompt", default="")
    p.add_argument("--provider", default="mock")
    p.add_argument("--apiKey", default="none")
    p.add_argument("--outDir", default=".")
    p.add_argument("--colors", default="White")
    p.add_argument("--refImage", default=None)
    p.add_argument("--imageSize", default="800x600", help="WxH e.g. 1024x768")

    # spin360 / video
    p.add_argument("--frames", type=int, default=36, help="Number of 360 spin frames")
    p.add_argument("--prefix", default="product", help="Output filename prefix")
    p.add_argument("--framesDir", default=None, help="Directory containing spin frames (video task)")
    p.add_argument("--fps", type=int, default=12)

    # rotate
    p.add_argument("--inputPath", default=None)
    p.add_argument("--degrees", type=int, default=90)

    # composite
    p.add_argument("--foreground", default=None)
    p.add_argument("--background", default=None)
    p.add_argument("--outputPath", default=None)

    return p


def main() -> int:
    args = build_parser().parse_args()
    jm = args.jsonMode
    dispatch = {
        "generate": task_generate,
        "recolor": task_recolor,
        "spin360": task_spin360,
        "video": task_video,
        "rotate": task_rotate,
        "composite": task_composite,
    }
    return dispatch[args.task](args, jm)


if __name__ == "__main__":
    sys.exit(main())
