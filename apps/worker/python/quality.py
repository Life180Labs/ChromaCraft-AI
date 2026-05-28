#!/usr/bin/env python3
"""
ChromaCraft AI Quality Validation Module.
Multi-metric similarity scoring: CLIP, DINOv2, SSIM, PSNR.
Threshold: 0.92+ aggregate for pass.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import warnings
from io import BytesIO
from typing import Optional

import numpy as np
from PIL import Image

warnings.filterwarnings("ignore")

# Optional imports — degrade gracefully
CLIP_AVAILABLE = False
DINOV2_AVAILABLE = False
TORCH_AVAILABLE = False

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    pass

try:
    import clip
    CLIP_AVAILABLE = TORCH_AVAILABLE
except ImportError:
    pass

try:
    # DINOv2 can be loaded via torch.hub or direct import
    DINOV2_AVAILABLE = TORCH_AVAILABLE
except ImportError:
    pass


# ---------------------------------------------------------------------------
# SSIM (Structural Similarity Index) — pure NumPy, no dependencies
# ---------------------------------------------------------------------------

def ssim(img1: np.ndarray, img2: np.ndarray, win_size: int = 7) -> float:
    """Compute SSIM between two images (grayscale)."""
    if img1.shape != img2.shape:
        h = min(img1.shape[0], img2.shape[0])
        w = min(img1.shape[1], img2.shape[1])
        img1 = img1[:h, :w]
        img2 = img2[:h, :w]

    if len(img1.shape) == 3:
        # Multi-channel: average over channels
        scores = []
        for c in range(min(img1.shape[2], img2.shape[2], 3)):
            scores.append(ssim(img1[:, :, c], img2[:, :, c], win_size))
        return float(np.mean(scores))

    img1 = img1.astype(np.float64)
    img2 = img2.astype(np.float64)

    k1, k2, L = 0.01, 0.03, 255.0
    c1 = (k1 * L) ** 2
    c2 = (k2 * L) ** 2

    mu1 = cv2_filter(img1, win_size)
    mu2 = cv2_filter(img2, win_size)
    mu1_sq = mu1 ** 2
    mu2_sq = mu2 ** 2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = cv2_filter(img1 ** 2, win_size) - mu1_sq
    sigma2_sq = cv2_filter(img2 ** 2, win_size) - mu2_sq
    sigma12 = cv2_filter(img1 * img2, win_size) - mu1_mu2

    ssim_map = ((2 * mu1_mu2 + c1) * (2 * sigma12 + c2)) / \
               ((mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2))
    return float(np.mean(ssim_map))


def cv2_filter(img: np.ndarray, win_size: int) -> np.ndarray:
    """Simple uniform filter (approximation of cv2.GaussianBlur)."""
    kernel = np.ones((win_size, win_size), dtype=np.float64) / (win_size * win_size)
    pad = win_size // 2
    padded = np.pad(img, pad, mode='reflect')
    result = np.zeros_like(img)
    for i in range(img.shape[0]):
        for j in range(img.shape[1]):
            result[i, j] = np.sum(padded[i:i + win_size, j:j + win_size] * kernel)
    return result


# ---------------------------------------------------------------------------
# PSNR (Peak Signal-to-Noise Ratio)
# ---------------------------------------------------------------------------

def psnr(img1: np.ndarray, img2: np.ndarray) -> float:
    """Compute PSNR between two images."""
    if img1.shape != img2.shape:
        h = min(img1.shape[0], img2.shape[0])
        w = min(img1.shape[1], img2.shape[1])
        img1 = img1[:h, :w]
        img2 = img2[:h, :w]

    mse = np.mean((img1.astype(np.float64) - img2.astype(np.float64)) ** 2)
    if mse == 0:
        return 100.0
    max_val = 255.0
    return float(20 * np.log10(max_val / np.sqrt(mse)))


# ---------------------------------------------------------------------------
# CLIP Score
# ---------------------------------------------------------------------------

def clip_score(img1: Image.Image, img2: Image.Image) -> float:
    """CLIP embedding cosine similarity."""
    if not CLIP_AVAILABLE:
        return 0.0

    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model, preprocess = clip.load("ViT-B/32", device=device, jit=False)

        with torch.no_grad():
            img1_tensor = preprocess(img1).unsqueeze(0).to(device)
            img2_tensor = preprocess(img2).unsqueeze(0).to(device)

            emb1 = model.encode_image(img1_tensor)
            emb2 = model.encode_image(img2_tensor)

            emb1 = emb1 / emb1.norm(dim=-1, keepdim=True)
            emb2 = emb2 / emb2.norm(dim=-1, keepdim=True)

            sim = (emb1 @ emb2.T).item()
        return float(sim)
    except Exception as e:
        print(f"[WARN] CLIP score failed: {e}", file=sys.stderr)
        return 0.0


# ---------------------------------------------------------------------------
# DINOv2 Score
# ---------------------------------------------------------------------------

def dinov2_score(img1: Image.Image, img2: Image.Image) -> float:
    """DINOv2 embedding cosine similarity."""
    if not DINOV2_AVAILABLE:
        return 0.0

    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = torch.hub.load('facebookresearch/dinov2', 'dinov2_vits14', pretrained=True)
        model.eval()
        model.to(device)

        from torchvision import transforms
        transform = transforms.Compose([
            transforms.Resize(224, interpolation=Image.BICUBIC),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])

        with torch.no_grad():
            t1 = transform(img1.convert("RGB")).unsqueeze(0).to(device)
            t2 = transform(img2.convert("RGB")).unsqueeze(0).to(device)

            emb1 = model(t1)
            emb2 = model(t2)

            # Use patch-level features for structural similarity
            emb1 = emb1.mean(dim=1)
            emb2 = emb2.mean(dim=1)

            emb1 = emb1 / emb1.norm(dim=-1, keepdim=True)
            emb2 = emb2 / emb2.norm(dim=-1, keepdim=True)

            sim = (emb1 @ emb2.T).item()
        return float(sim)
    except Exception as e:
        print(f"[WARN] DINOv2 score failed: {e}", file=sys.stderr)
        return 0.0


# ---------------------------------------------------------------------------
# Histogram Similarity (fast structural proxy)
# ---------------------------------------------------------------------------

def histogram_similarity(img1: np.ndarray, img2: np.ndarray) -> float:
    """Compare color histograms as a fast structural proxy."""
    if len(img1.shape) == 3:
        h1 = cv2_calc_hist(img1)
        h2 = cv2_calc_hist(img2)
    else:
        h1 = cv2_calc_hist_gray(img1)
        h2 = cv2_calc_hist_gray(img2)

    # Correlation
    h1 = h1 / (h1.sum() + 1e-10)
    h2 = h2 / (h2.sum() + 1e-10)
    score = float(np.sum(np.minimum(h1, h2)))
    return score


def cv2_calc_hist(img: np.ndarray, bins: int = 32) -> np.ndarray:
    """Compute flattened color histogram."""
    hists = []
    for c in range(min(img.shape[2], 3)):
        hist, _ = np.histogram(img[:, :, c], bins=bins, range=(0, 256))
        hists.append(hist.astype(np.float64))
    return np.concatenate(hists)


def cv2_calc_hist_gray(img: np.ndarray, bins: int = 32) -> np.ndarray:
    hist, _ = np.histogram(img, bins=bins, range=(0, 256))
    return hist.astype(np.float64)


# ---------------------------------------------------------------------------
# Main Validator
# ---------------------------------------------------------------------------

class QualityValidator:
    """Multi-metric quality validator with configurable threshold."""

    def __init__(self, threshold: float = 0.92):
        self.threshold = threshold

    def validate(self, original_path: str, generated_path: str) -> dict:
        """Run all metrics and return aggregated result."""
        if not os.path.isfile(original_path):
            return {
                "passed": False,
                "critique": f"Original not found: {original_path}",
                "clip_score": 0.0, "dinov2_score": 0.0,
                "ssim_score": 0.0, "psnr_score": 0.0,
                "histogram_score": 0.0, "aggregate": 0.0,
            }
        if not os.path.isfile(generated_path):
            return {
                "passed": False,
                "critique": f"Generated not found: {generated_path}",
                "clip_score": 0.0, "dinov2_score": 0.0,
                "ssim_score": 0.0, "psnr_score": 0.0,
                "histogram_score": 0.0, "aggregate": 0.0,
            }

        try:
            orig_pil = Image.open(original_path).convert("RGB")
            gen_pil = Image.open(generated_path).convert("RGB")

            orig_np = np.array(orig_pil)
            gen_np = np.array(gen_pil)

            # Sizes must match for pixel-level metrics
            if orig_np.shape != gen_np.shape:
                gen_np = cv2_resize(gen_np, orig_np.shape[1], orig_np.shape[0])
                gen_pil = Image.fromarray(gen_np)

            # Compute all scores
            clip_val = clip_score(orig_pil, gen_pil)
            dino_val = dinov2_score(orig_pil, gen_pil)

            # Pixel-level metrics
            orig_gray = np.mean(orig_np[:, :, :3], axis=2) if orig_np.ndim == 3 else orig_np
            gen_gray = np.mean(gen_np[:, :, :3], axis=2) if gen_np.ndim == 3 else gen_np

            ssim_val = ssim(orig_gray, gen_gray)
            psnr_val = psnr(orig_np, gen_np)
            hist_val = histogram_similarity(orig_np, gen_np)

            # Weighted aggregate
            weights = {"clip": 0.35, "dinov2": 0.35, "ssim": 0.15, "psnr": 0.05, "histogram": 0.10}
            aggregate = (
                weights["clip"] * clip_val +
                weights["dinov2"] * max(dino_val, clip_val * 0.8) +
                weights["ssim"] * ssim_val +
                weights["psnr"] * min(psnr_val / 50.0, 1.0) +
                weights["histogram"] * hist_val
            )

            passed = aggregate >= self.threshold

            return {
                "passed": passed,
                "critique": (
                    f"Aggregate similarity: {aggregate:.4f} (threshold: {self.threshold}). "
                    f"CLIP: {clip_val:.4f}, DINOv2: {dino_val:.4f}, "
                    f"SSIM: {ssim_val:.4f}, PSNR: {psnr_val:.2f}dB"
                ),
                "clip_score": round(clip_val, 4),
                "dinov2_score": round(dino_val, 4),
                "ssim_score": round(ssim_val, 4),
                "psnr_score": round(psnr_val, 2),
                "histogram_score": round(hist_val, 4),
                "aggregate": round(aggregate, 4),
                "threshold": self.threshold,
            }
        except Exception as exc:
            return {
                "passed": False,
                "critique": f"Validation error: {exc}",
                "clip_score": 0.0, "dinov2_score": 0.0,
                "ssim_score": 0.0, "psnr_score": 0.0,
                "histogram_score": 0.0, "aggregate": 0.0,
            }


def cv2_resize(img: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resize using PIL (no opencv dependency)."""
    pil = Image.fromarray(img)
    return np.array(pil.resize((width, height), Image.LANCZOS))


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ChromaCraft AI Quality Validator")
    p.add_argument("--original", required=True, help="Path to original reference image")
    p.add_argument("--generated", required=True, help="Path to generated image to validate")
    p.add_argument("--threshold", type=float, default=0.92, help="Quality pass threshold (0-1)")
    p.add_argument("--jsonMode", action="store_true", help="Output JSON only")
    return p


def main() -> int:
    args = build_parser().parse_args()

    validator = QualityValidator(threshold=args.threshold)
    result = validator.validate(args.original, args.generated)

    if args.jsonMode:
        print(json.dumps(result), flush=True)
    else:
        status = "PASS" if result["passed"] else "FAIL"
        print(f"[{status}] {result['critique']}")

    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
