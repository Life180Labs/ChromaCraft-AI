#!/usr/bin/env python3
"""
ChromaCraft Full Pipeline Runner.

Executes the complete ChromaCraft image-generation pipeline in order:
  1. generate.py  — colour recoloring (HSL shift / Stability AI)
  2. process.py   — background removal + identity lock
  3. multiview.py — 360 spin generation (ONLY when --refImage is supplied)
  4. video.py     — showcase video (ONLY when 360 frames exist in outDir)
  5. Validation   — confirms every expected output file exists

Usage
-----
  python pipeline.py \\
    --colors "White,Black,Blue" \\
    --refImage path/to/ref.png \\
    --outDir   output/raw \\
    --processedDir output/processed \\
    --prefix   MyProduct \\
    [--strategy hsl_shift|stability|controlnet] \\
    [--apiKey  <key>] \\
    [--jsonMode]

All paths may be relative or absolute.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Optional

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GENERATE_PY  = os.path.join(SCRIPT_DIR, "generate.py")
PROCESS_PY   = os.path.join(SCRIPT_DIR, "process.py")
MULTIVIEW_PY = os.path.join(SCRIPT_DIR, "multiview.py")
VIDEO_PY     = os.path.join(SCRIPT_DIR, "video.py")

RAW_FILE_PATTERN = re.compile(r"^raw_(.+)\.png$", re.IGNORECASE)
VIEW_ANGLES = [
    "front", "front_right", "right", "back_right",
    "back", "back_left", "left", "front_left", "top",
]


def color_to_slug(color: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", color.strip().replace(" ", "_"))


def log(msg: str, json_mode: bool = False) -> None:
    """Print a human-readable status line (suppressed in JSON mode)."""
    if not json_mode:
        print(msg, flush=True)


def emit_result(payload: dict, json_mode: bool) -> None:
    if json_mode:
        print(json.dumps(payload), flush=True)


def run_subprocess(cmd: list[str], label: str, json_mode: bool) -> subprocess.CompletedProcess:
    """Run a child script, stream stderr in human mode, return the result."""
    log(f"\n[PIPELINE] ▶ {label}", json_mode)
    log(f"           $ {' '.join(cmd)}", json_mode)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=600,
        cwd=SCRIPT_DIR,
    )

    # Always forward child stderr so the user can see progress / errors
    if result.stderr.strip():
        for line in result.stderr.strip().splitlines():
            print(f"  {line}", file=sys.stderr, flush=True)

    return result


# ---------------------------------------------------------------------------
# Stage 1 – generate.py
# ---------------------------------------------------------------------------

def stage_generate(args: argparse.Namespace) -> bool:
    """Run generate.py and return True on success."""
    cmd = [
        sys.executable, GENERATE_PY,
        "--task", "generate",
        "--colors", args.colors,
        "--outDir", args.outDir,
        "--strategy", args.strategy,
    ]
    if args.refImage:
        cmd += ["--refImage", args.refImage]
    if args.apiKey and args.apiKey != "none":
        cmd += ["--apiKey", args.apiKey]
    if args.prompt:
        cmd += ["--prompt", args.prompt]

    result = run_subprocess(cmd, "Image Generation (generate.py)", args.jsonMode)

    if result.returncode != 0:
        print(
            f"[PIPELINE][ERR] generate.py exited with code {result.returncode}",
            file=sys.stderr,
        )
        return False

    # Log any JSON lines emitted by the child
    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if line:
            log(f"  {line}", args.jsonMode)

    log("[PIPELINE] ✔ Stage 1 — Generation complete.", args.jsonMode)
    return True


# ---------------------------------------------------------------------------
# Stage 2 – process.py
# ---------------------------------------------------------------------------

def stage_process(args: argparse.Namespace) -> bool:
    """Run process.py and return True on success."""
    cmd = [
        sys.executable, PROCESS_PY,
        "--inputDir",  args.outDir,
        "--outputDir", args.processedDir,
        "--prefix",    args.prefix,
    ]
    if args.refImage:
        cmd += ["--refImage", args.refImage]
    if args.jsonMode:
        cmd += ["--jsonMode"]

    result = run_subprocess(cmd, "Post-Processing (process.py)", args.jsonMode)

    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if line:
            log(f"  {line}", args.jsonMode)

    if result.returncode != 0:
        print(
            f"[PIPELINE][ERR] process.py exited with code {result.returncode}",
            file=sys.stderr,
        )
        return False

    log("[PIPELINE] ✔ Stage 2 — Processing complete.", args.jsonMode)
    return True


# ---------------------------------------------------------------------------
# Stage 3 – multiview.py  (conditional: only when refImage exists)
# ---------------------------------------------------------------------------

def stage_multiview(args: argparse.Namespace) -> bool:
    """
    Run multiview.py to generate 360 spin frames.
    Only executed when --refImage is supplied and the file exists.
    Returns True on success, None/False when skipped or failed.
    """
    if not args.refImage or not os.path.isfile(args.refImage):
        log(
            "[PIPELINE] ⚠  Stage 3 — Skipping 360 spin: "
            f"--refImage not provided or file not found ({args.refImage!r}).",
            args.jsonMode,
        )
        return False

    spin_dir = args.spinDir or args.outDir
    cmd = [
        sys.executable, MULTIVIEW_PY,
        "--refImage", args.refImage,
        "--outDir",   spin_dir,
        "--prefix",   args.prefix,
        "--jsonMode",
    ]
    if args.provider:
        cmd += ["--provider", args.provider]
    if args.apiKey and args.apiKey != "none":
        cmd += ["--apiKey", args.apiKey]

    result = run_subprocess(cmd, "360 Spin Generation (multiview.py)", args.jsonMode)

    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if line:
            log(f"  {line}", args.jsonMode)

    if result.returncode != 0:
        print(
            f"[PIPELINE][ERR] multiview.py exited with code {result.returncode}",
            file=sys.stderr,
        )
        return False

    log("[PIPELINE] ✔ Stage 3 — 360 spin complete.", args.jsonMode)
    return True


# ---------------------------------------------------------------------------
# Stage 4 – video.py  (conditional: only when 360 frames exist)
# ---------------------------------------------------------------------------

def _360_frames_exist(frames_dir: str, prefix: str) -> list[str]:
    """Return sorted list of 360-frame paths found in frames_dir."""
    if not os.path.isdir(frames_dir):
        return []
    return sorted([
        os.path.join(frames_dir, f)
        for f in os.listdir(frames_dir)
        if f.startswith(f"{prefix}_360_") and f.endswith(".png")
    ])


def stage_video(args: argparse.Namespace, spin_succeeded: bool) -> Optional[str]:
    """
    Run video.py to assemble the showcase MP4.
    Only executed when 360 frames are actually present in frames_dir.
    Returns the output path on success, None otherwise.
    """
    spin_dir = args.spinDir or args.outDir
    frames = _360_frames_exist(spin_dir, args.prefix)

    if not frames:
        log(
            "[PIPELINE] ⚠  Stage 4 — Skipping video: "
            f"no 360 frames found in {spin_dir!r}.",
            args.jsonMode,
        )
        return None

    log(f"[PIPELINE]    Found {len(frames)} 360 frame(s) — proceeding with video.", args.jsonMode)

    video_out = args.videoOutput or os.path.join(spin_dir, f"{args.prefix}_showcase.mp4")
    cmd = [
        sys.executable, VIDEO_PY,
        "--task",      "showcase",
        "--framesDir", spin_dir,
        "--output",    video_out,
        "--prefix",    args.prefix,
        "--jsonMode",
    ]

    result = run_subprocess(cmd, "Showcase Video (video.py)", args.jsonMode)

    video_path: Optional[str] = None
    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                data = json.loads(line)
                if data.get("status") == "success":
                    video_path = data.get("path")
            except json.JSONDecodeError:
                pass
        if line:
            log(f"  {line}", args.jsonMode)

    if result.returncode != 0:
        print(
            f"[PIPELINE][ERR] video.py exited with code {result.returncode}",
            file=sys.stderr,
        )
        return None

    log("[PIPELINE] ✔ Stage 4 — Video complete.", args.jsonMode)
    return video_path or video_out


# ---------------------------------------------------------------------------
# Stage 5 – Validation
# ---------------------------------------------------------------------------

def stage_validate(
    colors: list[str],
    out_dir: str,
    processed_dir: str,
    prefix: str,
    spin_dir: str,
    video_path: Optional[str],
    json_mode: bool,
) -> dict:
    """
    Confirm every expected output file exists.
    Returns a validation summary dict.
    """
    log("\n[PIPELINE] ▶ Stage 5 — Validating outputs…", json_mode)
    missing: list[str] = []
    present: list[str] = []

    # Raw generation outputs
    for color in colors:
        slug = color_to_slug(color)
        p = os.path.join(out_dir, f"raw_{slug}.png")
        (present if os.path.isfile(p) else missing).append(p)

    # Processed outputs
    for color in colors:
        slug = color_to_slug(color)
        p = os.path.join(processed_dir, f"{prefix}_{slug}.png")
        (present if os.path.isfile(p) else missing).append(p)

    # 360 frames (optional — only checked if spin_dir has any)
    spin_frames = _360_frames_exist(spin_dir, prefix)
    for fp in spin_frames:
        (present if os.path.isfile(fp) else missing).append(fp)

    # Video (optional — only checked when a path was returned by stage_video)
    if video_path:
        (present if os.path.isfile(video_path) else missing).append(video_path)

    result = {
        "stage": "validate",
        "present": present,
        "missing": missing,
        "valid": len(missing) == 0,
    }

    if missing:
        log(f"[PIPELINE][WARN] {len(missing)} output(s) missing:", json_mode)
        for p in missing:
            log(f"          ✗ {p}", json_mode)
    else:
        log(f"[PIPELINE] ✔ All {len(present)} output(s) verified.", json_mode)

    return result


# ---------------------------------------------------------------------------
# Argument Parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="ChromaCraft Full Pipeline Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # Core inputs
    p.add_argument("--colors",   required=True,
                   help="Comma-separated colour names, e.g. 'White,Black,Blue'")
    p.add_argument("--refImage", default=None,
                   help="Path to reference image (enables 360 spin when provided)")
    p.add_argument("--prefix",   default="product",
                   help="Output filename prefix (default: product)")

    # Directories
    p.add_argument("--outDir",       required=True,
                   help="Directory for raw generated images")
    p.add_argument("--processedDir", default=None,
                   help="Directory for processed images (default: <outDir>/processed)")
    p.add_argument("--spinDir",      default=None,
                   help="Directory for 360 frames (default: same as --outDir)")
    p.add_argument("--videoOutput",  default=None,
                   help="Path for the output video (default: <spinDir>/<prefix>_showcase.mp4)")

    # Generation options
    p.add_argument("--strategy", default="hsl_shift",
                   choices=["hsl_shift", "stability", "sdxl_controlnet", "controlnet"],
                   help="Recoloring strategy (default: hsl_shift)")
    p.add_argument("--apiKey",   default="none",
                   help="API key for Stability/Tripo (or set CHROMACRAFT_API_KEY env var)")
    p.add_argument("--prompt",   default="",
                   help="Generation prompt (used by AI strategies)")
    p.add_argument("--provider", default="stability",
                   choices=["stability", "tripo"],
                   help="Provider for 360 spin (default: stability)")

    # Misc
    p.add_argument("--jsonMode", action="store_true",
                   help="Emit JSON-lines output for orchestrator consumption")

    return p


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = build_parser().parse_args()

    # Resolve derived directories
    if not args.processedDir:
        args.processedDir = os.path.join(args.outDir, "processed")
    if not args.spinDir:
        args.spinDir = args.outDir

    os.makedirs(args.outDir,       exist_ok=True)
    os.makedirs(args.processedDir, exist_ok=True)
    os.makedirs(args.spinDir,      exist_ok=True)

    colors = [c.strip() for c in args.colors.split(",") if c.strip()]

    log("=" * 65, args.jsonMode)
    log("  ChromaCraft Pipeline", args.jsonMode)
    log(f"  Colors   : {', '.join(colors)}", args.jsonMode)
    log(f"  RefImage : {args.refImage or '(none)'}", args.jsonMode)
    log(f"  Strategy : {args.strategy}", args.jsonMode)
    log(f"  OutDir   : {args.outDir}", args.jsonMode)
    log(f"  Processed: {args.processedDir}", args.jsonMode)
    log("=" * 65, args.jsonMode)

    # ------------------------------------------------------------------
    # Stage 1 – Generate
    # ------------------------------------------------------------------
    if not stage_generate(args):
        emit_result({"status": "error", "stage": "generate",
                     "reason": "generate.py failed"}, args.jsonMode)
        return 1

    # ------------------------------------------------------------------
    # Stage 2 – Process
    # ------------------------------------------------------------------
    if not stage_process(args):
        emit_result({"status": "error", "stage": "process",
                     "reason": "process.py failed"}, args.jsonMode)
        return 1

    # ------------------------------------------------------------------
    # Stage 3 – 360 Spin (conditional on refImage)
    # ------------------------------------------------------------------
    spin_ok = stage_multiview(args)

    # ------------------------------------------------------------------
    # Stage 4 – Video (conditional on 360 frames existing)
    # ------------------------------------------------------------------
    video_path = stage_video(args, spin_ok)

    # ------------------------------------------------------------------
    # Stage 5 – Validate all outputs
    # ------------------------------------------------------------------
    validation = stage_validate(
        colors=colors,
        out_dir=args.outDir,
        processed_dir=args.processedDir,
        prefix=args.prefix,
        spin_dir=args.spinDir,
        video_path=video_path,
        json_mode=args.jsonMode,
    )

    # ------------------------------------------------------------------
    # Final summary
    # ------------------------------------------------------------------
    summary = {
        "status":     "success" if validation["valid"] else "partial",
        "colors":     colors,
        "refImage":   args.refImage,
        "outDir":     args.outDir,
        "processedDir": args.processedDir,
        "spin360":    spin_ok,
        "videoPath":  video_path,
        "validation": validation,
    }

    emit_result(summary, args.jsonMode)

    if not args.jsonMode:
        log("\n" + "=" * 65, args.jsonMode)
        status_icon = "✔ SUCCESS" if validation["valid"] else "⚠  PARTIAL"
        log(f"  Pipeline complete — {status_icon}", args.jsonMode)
        if video_path:
            log(f"  Video       : {video_path}", args.jsonMode)
        log(f"  Present ({len(validation['present'])}): see --jsonMode for full list", args.jsonMode)
        if validation["missing"]:
            log(f"  Missing ({len(validation['missing'])}): {validation['missing']}", args.jsonMode)
        log("=" * 65, args.jsonMode)

    return 0 if validation["valid"] else 2


if __name__ == "__main__":
    sys.exit(main())
