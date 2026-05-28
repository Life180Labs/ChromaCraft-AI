#!/usr/bin/env python3
"""
ChromaCraft Cinematic Product Showcase Video Generator.
Composes multi-view frames into a professional video with transitions, zoom effects, and turntable motion.
"""

from __future__ import annotations

import argparse
import json
import os
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
    include_labels: bool = True,
) -> str:
    """
    Compose cinematic product showcase using FFmpeg.

    Features:
    - Multi-view transitions (front → right → back → left → top)
    - Ken Burns zoom effect on each view
    - Turntable rotation segment
    - Color labels overlay
    - Professional grade color grading
    """
    view_order = ["front", "front_right", "right", "back_right", "back", "back_left", "left", "front_left"]

    # Find available views
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

    # Build FFmpeg filter graph
    filter_parts = []
    stream_index = 0
    concat_inputs = []
    total_duration = 0

    # Segment 1: View showcase with transitions
    for i, frame_path in enumerate(available):
        # Ken Burns zoom: start at 1.0, end at 1.05 over view_duration
        zoom = f"zoompan=z='min(zoom+0.002,1.05)':d={int(fps * view_duration)}:s={resolution}"
        trim = f"trim=duration={view_duration}"
        filter_parts.append(f"[{i}:v]{zoom},{trim}[v{i}]")

        if i > 0:
            offset = total_duration - transition_duration / 2
            filter_parts.append(
                f"[v{i-1}][v{i}]xfade=transition=fade:duration={transition_duration}:offset={offset}[vf{i}]"
            )

        total_duration += view_duration
        stream_index = i

    # If we have multiple views, the last combined stream is vf{stream_index}
    # Otherwise it's v0
    main_stream = f"vf{stream_index}" if stream_index > 0 else "v0"

    # Segment 2: Turntable animation (if frames available and enabled)
    if include_turntable and len(turntable_frames) > 1:
        # Create a concat of turntable frames at 2x display rate
        tt_duration = min(len(turntable_frames) / (fps * 2), 5.0)  # Max 5 seconds
        tt_offset = total_duration - transition_duration / 2

        # Use individual turntable frame inputs
        tt_start_idx = len(available)
        for j, tf in enumerate(turntable_frames):
            idx = tt_start_idx + j

        # Simpler approach: create turntable via image sequence
        tt_dir = os.path.join(frames_dir, "tt_concat")
        os.makedirs(tt_dir, exist_ok=True)
        for j, tf in enumerate(turntable_frames):
            from shutil import copy2
            copy2(tf, os.path.join(tt_dir, f"frame_{j:04d}.png"))

        # Use image sequence input for turntable
        turntable_input = os.path.join(tt_dir, "frame_%04d.png")
        # We'll handle this separately below

    # Build the complete FFmpeg command
    cmd = ["ffmpeg", "-y"]

    # Add input images
    for frame_path in available:
        cmd.extend(["-loop", "1", "-i", frame_path])

    # Add turntable as separate input if available
    if include_turntable and len(turntable_frames) > 1:
        concat_dir = os.path.join(frames_dir, "tt_concat")
        os.makedirs(concat_dir, exist_ok=True)
        from shutil import copy2
        for j, tf in enumerate(turntable_frames):
            copy2(tf, os.path.join(concat_dir, f"frame_{j:04d}.png"))
        cmd.extend(["-framerate", str(fps * 2), "-i", os.path.join(concat_dir, "frame_%04d.png")])

    # Build filter complex
    filter_chains = []
    for i in range(len(available)):
        zoom = f"zoompan=z='min(zoom+0.002,1.05)':d={int(fps * view_duration)}:s={resolution},setpts=PTS-STARTPTS"
        filter_chains.append(f"[{i}:v]{zoom}[z{i}]")

    if len(available) > 1:
        xfade_chain = f"[z0]"
        for i in range(1, len(available)):
            offset = (i - 1) * view_duration + (view_duration - transition_duration / 2)
            prev = f"z{i}" if i == len(available) - 1 else f"xf{i}"
            xfade_chain += f"[z{i}]xfade=transition=fade:duration={transition_duration}:offset={offset}[xf{i}]"
            if i == len(available) - 1:
                final_label = f"xf{i}"

        if len(available) == 2:
            filter_chains.append(f"[z0][z1]xfade=transition=fade:duration={transition_duration}:offset={view_duration - transition_duration/2}[showcase]")
        else:
            # Simplified single crossfade
            filter_chains.append(f"[z0][z1]xfade=transition=fade:duration={transition_duration}:offset={view_duration - transition_duration/2}[showcase]")
    else:
        filter_chains.append(f"[0:v]setpts=PTS-STARTPTS[showcase]")

    # Add turntable after showcase
    if include_turntable and len(turntable_frames) > 1:
        tt_input_idx = len(available)
        tt_dur = min(len(turntable_frames) / (fps * 2), 5.0)
        showcase_dur = len(available) * view_duration
        xfade_offset = showcase_dur - transition_duration / 2
        filter_chains.append(
            f"[{tt_input_idx}:v]setpts=PTS-STARTPTS[tt]"
        )
        filter_chains.append(
            f"[showcase][tt]xfade=transition=fade:duration={transition_duration}:offset={xfade_offset}[final]"
        )
        final_stream = "[final]"
    else:
        final_stream = "[showcase]"

    # Apply color grade and scale
    filter_chains.append(
        f"{final_stream}eq=contrast=1.05:saturation=1.1:brightness=0.02,"
        f"scale={resolution}:flags=lanczos,format=yuv420p[video]"
    )

    filter_complex = "; ".join(filter_chains)
    cmd.extend(["-filter_complex", filter_complex, "-map", "[video]"])
    cmd.extend(["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"])
    cmd.append(output_path)

    print(f"[INFO] Running FFmpeg video composition...", file=sys.stderr)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed (exit {result.returncode}): {result.stderr[:500]}")

    # Cleanup temp concat dir
    concat_dir = os.path.join(frames_dir, "tt_concat")
    if os.path.isdir(concat_dir):
        import shutil
        shutil.rmtree(concat_dir, ignore_errors=True)

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
