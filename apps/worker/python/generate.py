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
        # Additional standard colors
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
    
    # Try parsing as custom hex color
    hex_str = name_clean
    if hex_str.startswith("#"):
        hex_str = hex_str[1:]
    
    # 6-digit hex
    if len(hex_str) == 6 and all(c in "0123456789abcdef" for c in hex_str):
        try:
            return (
                int(hex_str[0:2], 16),
                int(hex_str[2:4], 16),
                int(hex_str[4:6], 16)
            )
        except ValueError:
            pass

    # 3-digit hex
    if len(hex_str) == 3 and all(c in "0123456789abcdef" for c in hex_str):
        try:
            return (
                int(hex_str[0] * 2, 16),
                int(hex_str[1] * 2, 16),
                int(hex_str[2] * 2, 16)
            )
        except ValueError:
            pass

    return color_map.get(name_clean, (128, 128, 128))


def draw_car_silhouette(draw: ImageDraw.ImageDraw, color_rgb: tuple[int, int, int], width: int, height: int) -> None:
    cx = width // 2
    cy = height // 2 + 30
    
    wheel_y = cy + 40
    wheel_r = 35
    draw.line([(50, wheel_y + wheel_r), (width - 50, wheel_y + wheel_r)], fill=(100, 100, 100), width=4)
    
    wheel1_x = cx - 150
    wheel2_x = cx + 150
    
    # Shadow
    draw.ellipse([cx - 250, wheel_y + wheel_r - 8, cx + 250, wheel_y + wheel_r + 4], fill=(30, 30, 30))
    
    # Body
    body_points = [
        (cx - 240, cy + 20),
        (cx - 180, cy - 20),
        (cx - 100, cy - 60),
        (cx + 80, cy - 60),
        (cx + 160, cy - 10),
        (cx + 220, cy + 10),
        (cx + 230, cy + 40),
        (cx - 240, cy + 40),
    ]
    draw.polygon(body_points, fill=color_rgb, outline=(255, 255, 255), width=2)
    
    # Windows
    cabin_points = [
        (cx - 160, cy - 15),
        (cx - 95, cy - 52),
        (cx + 70, cy - 52),
        (cx + 140, cy - 10),
        (cx - 160, cy - 15),
    ]
    draw.polygon(cabin_points, fill=(40, 40, 50), outline=(255, 255, 255), width=2)
    draw.line([(cx - 10, cy - 52), (cx - 10, cy - 12)], fill=(255, 255, 255), width=2)
    
    # Lights
    draw.polygon([(cx - 240, cy + 20), (cx - 220, cy + 20), (cx - 225, cy + 30), (cx - 240, cy + 30)], fill=(255, 235, 100))
    draw.polygon([(cx + 220, cy + 10), (cx + 230, cy + 15), (cx + 230, cy + 25), (cx + 215, cy + 20)], fill=(255, 50, 50))
    
    # Wheels
    for wx in [wheel1_x, wheel2_x]:
        draw.ellipse([wx - wheel_r, wheel_y - wheel_r, wx + wheel_r, wheel_y + wheel_r], fill=(30, 30, 30), outline=(80, 80, 80), width=3)
        hub_r = 15
        draw.ellipse([wx - hub_r, wheel_y - hub_r, wx + hub_r, wheel_y + hub_r], fill=(200, 200, 200), outline=(100, 100, 100), width=2)


def generate_mock_image(job_id: str, prompt: str, color: str, out_dir: str, provider_label: str = "MOCK AI") -> None:
    """Generates a placeholder image with color metadata overlay."""
    width, height = 800, 800
    
    color_rgb = get_color_rgb(color)
    is_light_color = color.lower().strip() in ["white", "silver", "cream", "yellow", "pink"]
    if is_light_color:
        color1 = (60, 65, 75)
        color2 = (30, 35, 45)
        text_color = (255, 255, 255)
        accent_color = (255, 200, 80)
    else:
        color1 = (240, 242, 245)
        color2 = (190, 195, 200)
        text_color = (30, 30, 30)
        accent_color = (10, 25, 100)

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
    
    text_meta = (
        f"Job #{job_id} | Provider: {provider_label}\n"
        f"Prompt: {prompt[:80]}..."
    )
    draw.text((40, height - 80), text_meta, fill=text_color)
    draw.rectangle([0, 0, width - 1, height - 1], outline=accent_color, width=8)

    out_path = os.path.join(out_dir, raw_filename(color))
    img.save(out_path, "PNG")
    print(f"Generated mock variant: {out_path}")


def apply_color_tint(ref_path: str, color_name: str, out_path: str) -> None:
    """Load the reference image, apply a color tint/blend representing color_name, and save."""
    from PIL import Image, ImageChops
    try:
        # Open the original image
        img = Image.open(ref_path).convert("RGBA")
        
        # Get target RGB color
        color_rgb = get_color_rgb(color_name)
        
        # Create color overlay layer
        color_layer = Image.new("RGBA", img.size, color=(color_rgb[0], color_rgb[1], color_rgb[2], 255))
        
        # Blend the color layer into the image. Use multiply to preserve texture/details.
        tinted = ImageChops.multiply(img, color_layer)
        
        # Blend 55% of the tinted version with 45% of the original
        blended = Image.blend(img, tinted, 0.55)
        
        # Create non-white mask of the subject to preserve white/transparent background
        gray = img.convert("L")
        mask = gray.point(lambda x: 255 if x < 248 else 0, '1')
        
        # Split original alpha
        r, g, b, a = img.split()
        combined_mask = ImageChops.multiply(a, mask.convert("L"))
        
        # Composite tinted version back
        final_img = Image.composite(blended, img, combined_mask)
        final_img.save(out_path, "PNG")
        print(f"Generated colorized variant from reference: {out_path}")
    except Exception as e:
        print(f"Failed to apply color tint from reference: {e}. Falling back to blank canvas.", file=sys.stderr)
        raise e


def call_groq_api(prompt: str, color: str, api_key: str) -> str:
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    system_prompt = (
        "You are an expert prompt engineer for text-to-image AI generators. "
        "Expand and enhance the user's base image prompt to describe a stunning, professional automotive catalog or commercial photo. "
        "Explicitly specify the exterior paint finish color and highlight its details (e.g. metallic reflections, glossy highlights). "
        "Include rich descriptive words for lighting, clean background, camera type, and professional catalog composition. "
        "Provide ONLY the enhanced prompt string. Do not include any introductory or concluding text, explanations, or conversational filler."
    )
    user_prompt = f"Base prompt: {prompt}. Paint color: {color}."
    data = {
        "model": "llama3-8b-8192",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.7,
    }
    response = requests.post(url, headers=headers, json=data, timeout=30)
    response.raise_for_status()
    res_json = response.json()
    enhanced_prompt = res_json["choices"][0]["message"]["content"].strip()
    if enhanced_prompt.startswith('"') and enhanced_prompt.endswith('"'):
        enhanced_prompt = enhanced_prompt[1:-1]
    return enhanced_prompt


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
    parser.add_argument("--apiKey", default="none", help="Provider API Key")
    parser.add_argument("--outDir", required=True, help="Output directory path")
    parser.add_argument(
        "--colors",
        required=True,
        help='Comma-separated color names (e.g. "White,Black,Silver,Dark Blue")',
    )
    parser.add_argument("--refImage", default=None, help="Path to original uploaded reference image")

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
            # Replace [COLOR] placeholders in the prompt with the specific color name
            color_prompt = re.sub(r'\[color\]', color, args.prompt, flags=re.IGNORECASE)
            
            # Check if reference image is provided and exists
            if args.refImage and os.path.exists(args.refImage):
                out_path = os.path.join(args.outDir, raw_filename(color))
                apply_color_tint(args.refImage, color, out_path)
            else:
                if not args.apiKey or args.apiKey == "none" or provider_lower == "mock":
                    generate_mock_image(args.jobId, color_prompt, color, args.outDir)
                elif "openai" in provider_lower:
                    generate_openai_image(color_prompt, color, args.apiKey, args.outDir)
                elif "stability" in provider_lower:
                    generate_stability_image(color_prompt, color, args.apiKey, args.outDir)
                elif "groq" in provider_lower:
                    print(f"Calling Groq LLM API to enhance prompt for color '{color}'...")
                    try:
                        enhanced_prompt = call_groq_api(color_prompt, color, args.apiKey)
                        print(f"Groq enhanced prompt: {enhanced_prompt}")
                    except Exception as e:
                        print(f"Groq API error: {e}. Falling back to default prompt.", file=sys.stderr)
                        enhanced_prompt = f"{color_prompt}. Vehicle exterior color: {color}."
                    generate_mock_image(args.jobId, enhanced_prompt, color, args.outDir, "GROQ AI (Llama-3 Enhanced)")
                else:
                    generate_mock_image(args.jobId, color_prompt, color, args.outDir)
        except Exception as exc:
            print(f"Error generating color '{color}': {exc}", file=sys.stderr)
            if args.refImage and os.path.exists(args.refImage):
                out_path = os.path.join(args.outDir, raw_filename(color))
                try:
                    apply_color_tint(args.refImage, color, out_path)
                except Exception:
                    generate_mock_image(args.jobId, args.prompt, color, args.outDir)
            else:
                generate_mock_image(args.jobId, args.prompt, color, args.outDir)


if __name__ == "__main__":
    main()
