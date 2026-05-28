#!/usr/bin/env python3
"""
ChromaCraft Cinematic Product Showcase Video Generator.
Composes multi-view frames into a professional video with transitions, zoom effects, and turntable motion.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from typing import Optional


def compose_showcase_video(
    frames_dir: str,
    output_path: str,
    prefix: str = "product",
    fps: int = 30,
    transition_duration: float = 0.5,
    view_duration: float = 2.0,
    resolution: str = "1920x1080",
    include_turntable: bool = True,
) -> str:
    """
    Compose product showcase using FFmpeg concat with crossfade.
    """
    view_order = ["front", "front_right", "right", "back_right", "back", "back_left", "left", "front_left"]

    available = []
    for view in view_order:
        candidates = [
            os.path.join(frames_dir, f"{prefix}_360_{view}.png"),
            os.path.join(frames_dir, f"{prefix}_360_{view.upper()}.png"),
            os.path.join(frames_dir, f"360_{view}.png"),
        ]
        for c in candidates:
            if os.path.isfile(c):
                available.append(c)
                break

    turntable_frames = sorted([
        os.path.join(frames_dir, f) for f in os.listdir(frames_dir)
        if f.startswith(f"{prefix}_360_") and f.endswith(".png")
    ])

    if not available and not turntable_frames:
        raise ValueError("No view frames found for video composition")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    temp_dir = os.path.join(frames_dir, ".video_temp")
    os.makedirs(temp_dir, exist_ok=True)

    # Build per-view segments with Ken Burns zoom via FFmpeg
    seg_files = []
    for i, fp in enumerate(available):
        seg = os.path.join(temp_dir, f"seg_{i:04d}.mp4")
        seg_files.append(seg)
        subprocess.run([
            "ffmpeg", "-y", "-loop", "1", "-i", fp,
            "-vf", f"zoompan=z='min(zoom+0.002,1.05)':d={int(fps * view_duration)}:s={resolution},format=yuv420p",
            "-c:v", "libx264", "-t", str(view_duration), "-preset", "fast", "-crf", "20",
            seg,
        ], capture_output=True, check=True, timeout=60)

    # Build concat + xfade filter across all segments
    n_segs = len(seg_files)
    if n_segs == 1:
        final_seg = seg_files[0]
    else:
        filter_parts = []
        for i in range(n_segs):
            filter_parts.append(f"[{i}:v]setpts=PTS-STARTPTS[s{i}]")
        for i in range(n_segs - 1):
            offset = (i + 1) * view_duration - transition_duration
            if i == 0:
                filter_parts.append(f"[s0][s1]xfade=transition=fade:duration={transition_duration}:offset={offset}[t1]")
            elif i == n_segs - 2:
                filter_parts.append(f"[t{i}][s{i+1}]xfade=transition=fade:duration={transition_duration}:offset={offset}[showcase]")
            else:
                filter_parts.append(f"[t{i}][s{i+1}]xfade=transition=fade:duration={transition_duration}:offset={offset}[t{i+1}]")

        xfade_out = os.path.join(temp_dir, "showcase.mp4")
        subprocess.run([
            "ffmpeg", "-y"] + sum([["-i", s] for s in seg_files], []) + [
            "-filter_complex", "; ".join(filter_parts),
            "-map", "[showcase]", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            xfade_out,
        ], capture_output=True, check=True, timeout=120)
        final_seg = xfade_out

    # Add turntable segment if available
    if include_turntable and len(turntable_frames) > 1:
        tt_seg = os.path.join(temp_dir, "turntable.mp4")
        subprocess.run([
            "ffmpeg", "-y",
            "-framerate", str(min(fps * 2, 24)),
            "-pattern_type", "glob", "-i", os.path.join(frames_dir, f"{prefix}_360_*.png"),
            "-vf", f"scale={resolution}:flags=lanczos,format=yuv420p",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            tt_seg,
        ], capture_output=True, check=True, timeout=60)

        # Concatenate showcase + turntable with crossfade
        final_out = os.path.join(temp_dir, "final.mp4")
        subprocess.run([
            "ffmpeg", "-y", "-i", final_seg, "-i", tt_seg,
            "-filter_complex",
            f"[0:v]setpts=PTS-STARTPTS[show];[1:v]setpts=PTS-STARTPTS[tt];"
            f"[show][tt]xfade=transition=fade:duration={transition_duration}:offset={view_duration * n_segs - transition_duration}[out]",
            "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            final_out,
        ], capture_output=True, check=True, timeout=120)
        final_seg = final_out

    # Copy final output
    shutil.copy2(final_seg, output_path)

    # Cleanup temp dir
    shutil.rmtree(temp_dir, ignore_errors=True)

    return output_path


def create_simple_video(ref_image_path: str, output_path: str, duration: int = 5) -> str:
    """
    Simple fallback: create a gentle Ken Burns zoom video from a single image.
    """
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", ref_image_path,
        "-c:v", "libx264",
        "-t", str(duration),
        "-pix_fmt", "yuv420p",
        "-vf", "zoompan=z='min(zoom+0.001,1.03)':d=150:s=1920x1080",
        "-preset", "medium",
        "-crf", "18",
        output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    return output_path


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft Video Showcase Generator")
    p.add_argument("--task", choices=["showcase", "simple"], default="showcase")
    p.add_argument("--refImage", default=None)
    p.add_argument("--framesDir", default=".")
    p.add_argument("--output", required=True)
    p.add_argument("--prefix", default="product")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--resolution", default="1920x1080")
    p.add_argument("--jsonMode", action="store_true")
    return p


def main() -> int:
    args = build_parser().parse_args()

    try:
        if args.task == "showcase":
            out = compose_showcase_video(
                frames_dir=args.framesDir,
                output_path=args.output,
                prefix=args.prefix,
                fps=args.fps,
                resolution=args.resolution,
            )
        else:
            if not args.refImage or not os.path.isfile(args.refImage):
                raise ValueError("--refImage required for simple video")
            out = create_simple_video(args.refImage, args.output)

        if args.jsonMode:
            print(json.dumps({"status": "success", "path": out}), flush=True)
        else:
            print(f"[OK] Video: {out}")
        return 0

    except Exception as exc:
        if args.jsonMode:
            print(json.dumps({"status": "error", "reason": str(exc)}), flush=True)
        else:
            print(f"[ERR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
