#!/usr/bin/env python3
import argparse
import base64
import os
import random
import re
import sys

import requests
from PIL import Image, ImageDraw


def color_to_slug(color: str) -> str:
    """Convert a color label to a filesystem-safe slug (e.g. 'Dark Blue' -> 'Dark_Blue')."""
    slug = color.strip().replace(" ", "_")
    return re.sub(r"[^A-Za-z0-9_]", "", slug)


def parse_colors(colors_arg: str) -> list[str]:
    """Parse comma-separated color names."""
    return [c.strip() for c in colors_arg.split(",") if c.strip()]


def raw_filename(color: str) -> str:
    return f"raw_{color_to_slug(color)}.png"


def generate_mock_image(job_id: str, prompt: str, color: str, out_dir: str) -> None:
    """Generates a placeholder image with color metadata overlay."""
    width, height = 800, 800
    color1 = (random.randint(20, 100), random.randint(20, 100), random.randint(150, 255))
    color2 = (random.randint(150, 255), random.randint(50, 150), random.randint(20, 100))

    img = Image.new("RGB", (width, height), color=color1)
    draw = ImageDraw.Draw(img)

    for y in range(height):
        r = int(color1[0] + (color2[0] - color1[0]) * (y / height))
        g = int(color1[1] + (color2[1] - color1[1]) * (y / height))
        b = int(color1[2] + (color2[2] - color1[2]) * (y / height))
        for x in range(width):
            draw.point((x, y), fill=(r, g, b))

    for _ in range(5):
        cx = random.randint(100, 700)
        cy = random.randint(100, 700)
        r = random.randint(50, 150)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255), width=2)

    text = (
        f"Job #{job_id} | Color: {color}\n"
        f"Prompt: {prompt[:40]}...\n"
        f"Provider: MOCK AI"
    )
    draw.text((40, 40), text, fill=(255, 255, 255))
    draw.rectangle([0, 0, width - 1, height - 1], outline=(255, 200, 80), width=8)

    out_path = os.path.join(out_dir, raw_filename(color))
    img.save(out_path, "PNG")
    print(f"Generated mock variant: {out_path}")


def generate_openai_image(prompt: str, color: str, api_key: str, out_dir: str) -> None:
    color_prompt = f"{prompt}. Vehicle exterior color: {color}."
    url = "https://api.openai.com/v1/images/generations"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = {
        "model": "dall-e-3",
        "prompt": color_prompt,
        "n": 1,
        "size": "1024x1024",
    }
    response = requests.post(url, headers=headers, json=data, timeout=60)
    response.raise_for_status()
    res_json = response.json()
    img_url = res_json["data"][0]["url"]

    img_data = requests.get(img_url, timeout=30).content
    out_path = os.path.join(out_dir, raw_filename(color))
    with open(out_path, "wb") as f:
        f.write(img_data)
    print(f"Generated OpenAI variant: {out_path}")


def generate_stability_image(prompt: str, color: str, api_key: str, out_dir: str) -> None:
    color_prompt = f"{prompt}. Vehicle exterior color: {color}."
    url = "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    data = {
        "text_prompts": [{"text": color_prompt, "weight": 1}],
        "cfg_scale": 7,
        "height": 1024,
        "width": 1024,
        "samples": 1,
        "steps": 30,
    }
    response = requests.post(url, headers=headers, json=data, timeout=60)
    response.raise_for_status()
    res_json = response.json()

    img_b64 = res_json["artifacts"][0]["base64"]
    img_data = base64.b64decode(img_b64)

    out_path = os.path.join(out_dir, raw_filename(color))
    with open(out_path, "wb") as f:
        f.write(img_data)
    print(f"Generated Stability variant: {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="ChromaCraft Image Generation Worker")
    parser.add_argument("--jobId", required=True, help="Job identifier")
    parser.add_argument("--prompt", required=True, help="Prompt text")
    parser.add_argument("--provider", required=True, help="AI Provider name")
    parser.add_argument("--apiKey", default="", help="Provider API Key")
    parser.add_argument("--outDir", required=True, help="Output directory path")
    parser.add_argument(
        "--colors",
        required=True,
        help='Comma-separated color names (e.g. "White,Black,Silver,Dark Blue")',
    )

    args = parser.parse_args()
    colors = parse_colors(args.colors)

    if not colors:
        print("Error: --colors must contain at least one color name", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.outDir, exist_ok=True)
    provider_lower = args.provider.lower()

    print(f"Starting script for Job {args.jobId} using {args.provider}")
    print(f"Generating {len(colors)} color variant(s): {', '.join(colors)}")

    for color in colors:
        try:
            if not args.apiKey or provider_lower == "mock":
                generate_mock_image(args.jobId, args.prompt, color, args.outDir)
            elif "openai" in provider_lower:
                generate_openai_image(args.prompt, color, args.apiKey, args.outDir)
            elif "stability" in provider_lower:
                generate_stability_image(args.prompt, color, args.apiKey, args.outDir)
            else:
                generate_mock_image(args.jobId, args.prompt, color, args.outDir)
        except Exception as exc:
            print(f"Error generating color '{color}': {exc}", file=sys.stderr)
            generate_mock_image(args.jobId, args.prompt, color, args.outDir)


if __name__ == "__main__":
    main()
