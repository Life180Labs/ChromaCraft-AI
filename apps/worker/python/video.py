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


def _run_ffmpeg(args: list, label: str = "", timeout: int = 120) -> None:
    """Run ffmpeg and raise with stderr context on failure."""
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=timeout
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg{' (' + label + ')' if label else ''} failed (exit {result.returncode}):\n"
            + result.stderr[-1500:]
        )


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

    # Use all 360 frames as turntable source (sorted for consistent ordering)
    turntable_frames = sorted([
        os.path.join(frames_dir, f) for f in os.listdir(frames_dir)
        if f.startswith(f"{prefix}_360_") and f.endswith(".png")
    ])

    # If we have no named views, fall back to treating all turntable frames as the view sequence
    if not available and turntable_frames:
        available = turntable_frames

    if not available:
        raise ValueError("No view frames found for video composition")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    temp_dir = os.path.join(frames_dir, ".video_temp")
    os.makedirs(temp_dir, exist_ok=True)

    try:
        # ----------------------------------------------------------------
        # Build per-view segments with Ken Burns zoom via FFmpeg
        # ----------------------------------------------------------------
        seg_files = []
        for i, fp in enumerate(available):
            seg = os.path.join(temp_dir, f"seg_{i:04d}.mp4")
            seg_files.append(seg)
            _run_ffmpeg([
                "ffmpeg", "-y", "-loop", "1", "-i", fp,
                "-vf",
                f"scale={resolution}:flags=lanczos,"
                f"zoompan=z='min(zoom+0.002,1.05)':d={int(fps * view_duration)}:s={resolution},"
                f"format=yuv420p",
                "-c:v", "libx264", "-t", str(view_duration), "-preset", "fast", "-crf", "20",
                seg,
            ], label=f"seg-{i}", timeout=90)

        # ----------------------------------------------------------------
        # Concat + xfade across all segments
        # BUG FIX: when n_segs == 2, i==0 is ALSO i==n_segs-2, so we must
        # use a single branch that handles 2 segments without collision.
        # ----------------------------------------------------------------
        n_segs = len(seg_files)
        if n_segs == 0:
            raise ValueError("No segments were built")

        if n_segs == 1:
            final_seg = seg_files[0]

        elif n_segs == 2:
            # Special-case: exactly 2 segments — single xfade, output label [showcase]
            offset = view_duration - transition_duration
            xfade_out = os.path.join(temp_dir, "showcase.mp4")
            _run_ffmpeg([
                "ffmpeg", "-y",
                "-i", seg_files[0], "-i", seg_files[1],
                "-filter_complex",
                f"[0:v]setpts=PTS-STARTPTS[s0];"
                f"[1:v]setpts=PTS-STARTPTS[s1];"
                f"[s0][s1]xfade=transition=fade:duration={transition_duration}:offset={offset}[showcase]",
                "-map", "[showcase]",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                xfade_out,
            ], label="xfade-2seg", timeout=120)
            final_seg = xfade_out

        else:
            # General case: n_segs >= 3
            # setpts for all inputs
            filter_parts = [f"[{i}:v]setpts=PTS-STARTPTS[s{i}]" for i in range(n_segs)]
            # chain xfades: s0+s1→t1, t1+s2→t2, …, t(n-2)+s(n-1)→showcase
            for i in range(n_segs - 1):
                offset = (i + 1) * view_duration - transition_duration
                in_a = f"s{i}" if i == 0 else f"t{i}"
                out_label = "showcase" if i == n_segs - 2 else f"t{i + 1}"
                filter_parts.append(
                    f"[{in_a}][s{i+1}]xfade=transition=fade:"
                    f"duration={transition_duration}:offset={offset}[{out_label}]"
                )

            xfade_out = os.path.join(temp_dir, "showcase.mp4")
            _run_ffmpeg(
                ["ffmpeg", "-y"]
                + sum([["-i", s] for s in seg_files], [])
                + [
                    "-filter_complex", "; ".join(filter_parts),
                    "-map", "[showcase]",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                    xfade_out,
                ],
                label="xfade-multi",
                timeout=180,
            )
            final_seg = xfade_out

        # ----------------------------------------------------------------
        # Append turntable loop segment
        # BUG FIX: use explicit file list instead of glob (glob is broken
        # on Windows ffmpeg builds and in some Docker environments).
        # ----------------------------------------------------------------
        if include_turntable and len(turntable_frames) > 1:
            tt_seg = os.path.join(temp_dir, "turntable.mp4")

            # Write a concat list file — works on all platforms
            list_path = os.path.join(temp_dir, "frames.txt")
            with open(list_path, "w") as lf:
                for fp in turntable_frames:
                    lf.write(f"file '{fp}'\n")

            _run_ffmpeg([
                "ffmpeg", "-y",
                "-r", str(min(fps * 2, 24)),
                "-f", "concat", "-safe", "0", "-i", list_path,
                "-vf", f"scale={resolution}:flags=lanczos,format=yuv420p",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                tt_seg,
            ], label="turntable", timeout=90)

            # Concatenate showcase + turntable with crossfade
            tt_offset = max(0.1, view_duration * n_segs - transition_duration)
            final_out = os.path.join(temp_dir, "final.mp4")
            _run_ffmpeg([
                "ffmpeg", "-y", "-i", final_seg, "-i", tt_seg,
                "-filter_complex",
                f"[0:v]setpts=PTS-STARTPTS[show];"
                f"[1:v]setpts=PTS-STARTPTS[tt];"
                f"[show][tt]xfade=transition=fade:duration={transition_duration}:offset={tt_offset}[out]",
                "-map", "[out]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                final_out,
            ], label="concat-turntable", timeout=180)
            final_seg = final_out

        # Copy final output
        shutil.copy2(final_seg, output_path)

    finally:
        # Always clean up temp dir
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
