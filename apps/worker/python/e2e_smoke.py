#!/usr/bin/env python3
"""End-to-end smoke test for UC1 Python pipeline (no Redis/DB required)."""

import os
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GENERATE = os.path.join(SCRIPT_DIR, "generate.py")
PROCESS = os.path.join(SCRIPT_DIR, "process.py")

COLORS = "White,Black,Silver,Dark Blue"
PREFIX = "Mitsubishi_ASX"
EXPECTED_RAW = ["raw_White.png", "raw_Black.png", "raw_Silver.png", "raw_Dark_Blue.png"]
EXPECTED_PROCESSED = [
    f"{PREFIX}_White.png",
    f"{PREFIX}_Black.png",
    f"{PREFIX}_Silver.png",
    f"{PREFIX}_Dark_Blue.png",
]


def run(cmd: list[str], cwd: str) -> None:
    print(f">>> {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"Command failed with exit code {result.returncode}")


def main() -> int:
    work_dir = tempfile.mkdtemp(prefix="chromacraft-e2e-")
    processed_dir = os.path.join(work_dir, "processed")
    os.makedirs(processed_dir, exist_ok=True)

    try:
        run(
            [
                sys.executable,
                GENERATE,
                "--jobId", "e2e",
                "--prompt", "Mitsubishi ASX catalog shot",
                "--provider", "mock",
                "--apiKey", "none",
                "--outDir", work_dir,
                "--colors", COLORS,
            ],
            cwd=SCRIPT_DIR,
        )

        for name in EXPECTED_RAW:
            path = os.path.join(work_dir, name)
            if not os.path.isfile(path):
                raise FileNotFoundError(f"Missing raw output: {name}")

        run(
            [
                sys.executable,
                PROCESS,
                "--inputDir", work_dir,
                "--outputDir", processed_dir,
                "--prefix", PREFIX,
            ],
            cwd=SCRIPT_DIR,
        )

        for name in EXPECTED_PROCESSED:
            path = os.path.join(processed_dir, name)
            if not os.path.isfile(path):
                raise FileNotFoundError(f"Missing processed output: {name}")
            img = Image.open(path)
            if img.size != (800, 600):
                raise ValueError(f"{name}: expected 800x600, got {img.size}")
            if img.mode != "RGBA":
                raise ValueError(f"{name}: expected RGBA, got {img.mode}")

        print("\n[PASS] UC1 Python E2E smoke test passed")
        print(f"   Work dir: {work_dir}")
        return 0
    except Exception as exc:
        print(f"\n[FAIL] UC1 Python E2E smoke test failed: {exc}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
