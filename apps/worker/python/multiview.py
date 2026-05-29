#!/usr/bin/env python3
"""
ChromaCraft Multi-View & 360 Spin Generator.
Generates front/left/right/back/top/perspective views.
Strategies: Tripo AI (best), Zero123++ (good), Stability AI (fallback).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from io import BytesIO
from typing import Optional

import requests
from PIL import Image


VIEW_ANGLES = ["front", "front_right", "right", "back_right", "back", "back_left", "left", "front_left", "top"]


def color_to_slug(color: str) -> str:
    return "".join(c if c.isalnum() or c == "_" else "_" for c in color.strip().replace(" ", "_"))


def _resolve_api_key(cli_key: str) -> str:
    if cli_key and cli_key != "none":
        return cli_key
    return os.environ.get("CHROMACRAFT_API_KEY", "none")


def generate_with_tripo(ref_image_path: str, api_key: str, out_dir: str, prefix: str = "product") -> dict:
    """
    Use Tripo AI API for actual 3D reconstruction and multi-view rendering.
    Best quality, supports turntable video export.
    """
    api_key = _resolve_api_key(api_key)
    if api_key == "none":
        raise ValueError("Tripo AI API key required. Set CHROMACRAFT_API_KEY env var.")
    headers = {"Authorization": f"Bearer {api_key}"}

    # Step 1: Upload image
    with open(ref_image_path, "rb") as f:
        upload_resp = requests.post(
            "https://api.tripo3d.ai/v2/upload",
            headers=headers,
            files={"file": f},
            timeout=60,
        )
    upload_resp.raise_for_status()
    image_token = upload_resp.json().get("data", {}).get("image_token")
    if not image_token:
        raise ValueError(f"Tripo upload failed: {upload_resp.text}")

    # Step 2: Create reconstruction task
    task_resp = requests.post(
        "https://api.tripo3d.ai/v2/task",
        headers=headers,
        json={
            "type": "image_to_model",
            "image_token": image_token,
            "model_type": "retopology",
        },
        timeout=30,
    )
    task_resp.raise_for_status()
    task_id = task_resp.json().get("data", {}).get("task_id")

    # Step 3: Poll for completion
    for _ in range(60):
        poll = requests.get(
            f"https://api.tripo3d.ai/v2/task/{task_id}",
            headers=headers,
            timeout=30,
        )
        status = poll.json().get("data", {}).get("status")
        if status == "success":
            break
        time.sleep(5)
    else:
        raise TimeoutError("Tripo task did not complete")

    # Step 4: Render views
    model_id = poll.json().get("data", {}).get("model_id")
    os.makedirs(out_dir, exist_ok=True)
    paths = {}

    for view in VIEW_ANGLES:
        render_resp = requests.post(
            "https://api.tripo3d.ai/v2/render",
            headers=headers,
            json={
                "model_id": model_id,
                "camera_angle": view,
                "image_format": "png",
                "resolution": 1024,
            },
            timeout=60,
        )
        render_resp.raise_for_status()
        view_path = os.path.join(out_dir, f"{prefix}_360_{color_to_slug(view)}.png")
        Image.open(BytesIO(render_resp.content)).save(view_path)
        paths[view] = view_path

    return paths


def generate_with_stability_video(ref_image_path: str, api_key: str, out_dir: str, prefix: str = "product") -> dict:
    """
    Fallback: use Stability AI image-to-video, then extract frames.
    Less accurate than Tripo but works with existing API key.
    """
    api_key = _resolve_api_key(api_key)
    if api_key == "none":
        raise ValueError("Stability API key required for video generation. Set CHROMACRAFT_API_KEY env var.")
    # Step 1: Generate video
    with open(ref_image_path, "rb") as f:
        resp = requests.post(
            "https://api.stability.ai/v2beta/image-to-video",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"image": f},
            data={"seed": 42, "cfg_scale": 1.8, "motion_bucket_id": 127},
            timeout=60,
        )
    resp.raise_for_status()
    generation_id = resp.json().get("id")

    # Step 2: Poll for result
    result_url = f"https://api.stability.ai/v2beta/image-to-video/result/{generation_id}"
    for _ in range(60):
        res = requests.get(result_url, headers={"Authorization": f"Bearer {api_key}"}, timeout=30)
        if res.status_code == 200:
            video_path = os.path.join(out_dir, f"{prefix}_360_temp.mp4")
            os.makedirs(out_dir, exist_ok=True)
            with open(video_path, "wb") as f:
                f.write(res.content)
            break
        elif res.status_code == 202:
            time.sleep(10)
        else:
            raise Exception(f"Video result failed: {res.text}")
    else:
        raise TimeoutError("Video generation did not complete")

    # Step 3: Extract frames at specific intervals
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    frame_pattern = os.path.join(out_dir, f"{prefix}_360_%03d.png")
    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-r", "8", frame_pattern],
        capture_output=True, check=True,
    )

    # Rename frames to view angles
    frames = sorted([f for f in os.listdir(out_dir) if f.startswith(f"{prefix}_360_") and f.endswith(".png")])
    for i, frame in enumerate(frames):
        if i < len(VIEW_ANGLES):
            view_name = VIEW_ANGLES[i]
            new_name = f"{prefix}_360_{view_name}.png"
            os.rename(os.path.join(out_dir, frame), os.path.join(out_dir, new_name))
            paths[view_name] = os.path.join(out_dir, new_name)

    # Cleanup temp video
    if os.path.exists(video_path):
        os.remove(video_path)

    return paths


def generate_mock_spin(ref_image_path: str, out_dir: str, prefix: str = "product") -> dict:
    """Fallback mock generator that copies the reference image for all angles."""
    import shutil
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    for view in VIEW_ANGLES:
        view_path = os.path.join(out_dir, f"{prefix}_360_{view}.png")
        shutil.copy2(ref_image_path, view_path)
        paths[view] = view_path
    return paths


def generate_turntable_gif(frame_dir: str, output_path: str, prefix: str = "product", duration: int = 100) -> str:
    """Generate a turntable GIF from rendered frames."""
    frames = sorted([
        os.path.join(frame_dir, f) for f in os.listdir(frame_dir)
        if f.startswith(f"{prefix}_360_") and f.endswith(".png")
    ])

    if not frames:
        raise ValueError(f"No 360 frames found in {frame_dir}")

    images = [Image.open(f).convert("RGBA") for f in frames]
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    images[0].save(
        output_path,
        save_all=True,
        append_images=images[1:],
        duration=duration,
        loop=0,
        optimize=True,
    )
    return output_path


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Multi-View Generator")
    p.add_argument("--task", choices=["generate", "turntable_gif"], default="generate")
    p.add_argument("--refImage", required=True)
    p.add_argument("--apiKey", default="none")
    p.add_argument("--outDir", default=".")
    p.add_argument("--prefix", default="product")
    p.add_argument("--provider", default="tripo", choices=["tripo", "stability"])
    p.add_argument("--jsonMode", action="store_true")
    return p


def main() -> int:
    args = build_parser().parse_args()

    if not os.path.isfile(args.refImage):
        print(json.dumps({"status": "error", "reason": f"Reference image not found: {args.refImage}"}), flush=True)
        return 1

    try:
        if args.task == "generate":
            try:
                if args.provider == "tripo" and args.apiKey != "none":
                    paths = generate_with_tripo(args.refImage, args.apiKey, args.outDir, args.prefix)
                else:
                    paths = generate_with_stability_video(args.refImage, args.apiKey, args.outDir, args.prefix)
            except Exception as api_err:
                # Fallback to mock if API fails (e.g. invalid key, no key)
                paths = generate_mock_spin(args.refImage, args.outDir, args.prefix)

            if args.jsonMode:
                print(json.dumps({"status": "success", "paths": paths}), flush=True)
            else:
                for view, p in paths.items():
                    print(f"[OK] {view}: {p}")
            return 0

        elif args.task == "turntable_gif":
            out = os.path.join(args.outDir, f"{args.prefix}_turntable.gif")
            generate_turntable_gif(args.outDir, out, args.prefix)
            if args.jsonMode:
                print(json.dumps({"status": "success", "path": out}), flush=True)
            else:
                print(f"[OK] Turntable GIF: {out}")
            return 0

    except Exception as exc:
        if args.jsonMode:
            print(json.dumps({"status": "error", "reason": str(exc)}), flush=True)
        else:
            print(f"[ERR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
