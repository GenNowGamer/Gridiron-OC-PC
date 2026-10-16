"""Closed-set down-and-distance reader for Madden HUD crops.

PP-OCRv5 spells outlined ordinals as digits (2ND → 200, 3RD → 30). This
reader splits the crop on the gaps around the ampersand and matches the
ordinal and the yards against a fixed legal set. A thin marker or a distant
trailing glyph is left outside those three chunks.
"""

from __future__ import annotations

import os

import numpy as np

_ORDINALS = ("1ST", "2ND", "3RD", "4TH")
_YARD_LABELS = [str(n) for n in range(1, 41)] + ["GOAL", "INCHES"]
_MIN_MARGIN = 0.02
_MIN_ORDINAL_SCORE = 0.18
_MIN_YARD_SCORE = 0.22
_FONT_CANDIDATES = (
    "impact.ttf",
    "GOTHICB.TTF",
    "arialnb.ttf",
    "ariblk.ttf",
    "arialbd.ttf",
)


def _font_paths():
    windir = os.environ.get("WINDIR", r"C:\Windows")
    folder = os.path.join(windir, "Fonts")
    return [os.path.join(folder, name) for name in _FONT_CANDIDATES if os.path.isfile(os.path.join(folder, name))]


def _gray(image):
    if image is None:
        return None
    array = np.asarray(image)
    if array.size == 0:
        return None
    if array.ndim == 2:
        return array.astype(np.uint8)
    # Capture crops are BGR. Outlined HUD text is the bright channel.
    return array.max(axis=2).astype(np.uint8)


def _ink_mask(gray):
    if gray is None or gray.size == 0:
        return None
    bright = gray >= 150
    if int(bright.sum()) < 12:
        bright = gray >= max(40, int(np.percentile(gray, 92)))
    rows = np.where(bright.sum(axis=1) > 1)[0]
    if rows.size == 0:
        return None
    # Drop a baseline rule under the glyphs when a blank band separates it.
    splits = np.where(np.diff(rows) > 2)[0]
    if splits.size:
        groups = []
        start = 0
        for split in splits:
            groups.append(rows[start:split + 1])
            start = split + 1
        groups.append(rows[start:])
        rows = max(groups, key=lambda group: int(bright[group].sum()))
    mask = np.zeros_like(bright)
    mask[rows.min():rows.max() + 1] = bright[rows.min():rows.max() + 1]
    return mask


def _runs(mask):
    cols = mask.sum(axis=0)
    runs = []
    start = None
    for index, count in enumerate(cols.tolist()):
        on = count > 1
        if on and start is None:
            start = index
        elif not on and start is not None:
            runs.append([start, index - 1])
            start = None
    if start is not None:
        runs.append([start, mask.shape[1] - 1])
    return runs


def _merge_touching(runs):
    if not runs:
        return []
    merged = [runs[0][:]]
    for start, end in runs[1:]:
        gap = start - merged[-1][1] - 1
        if gap <= 1:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return merged


def _trim_bleed(runs):
    """Drop a 1–3px marker on the left, or a distant narrow glyph on the right."""
    if len(runs) >= 2:
        width = runs[0][1] - runs[0][0] + 1
        gap = runs[1][0] - runs[0][1] - 1
        if width <= 3 and gap >= 8:
            runs = runs[1:]
    if len(runs) >= 2:
        width = runs[-1][1] - runs[-1][0] + 1
        gap = runs[-1][0] - runs[-2][1] - 1
        heights = [run[1] - run[0] + 1 for run in runs[:-1]]
        typical = float(np.median(heights)) if heights else width
        if width <= max(4, typical * 0.45) and gap >= 8:
            runs = runs[:-1]
    return runs


def segment_down_distance(image):
    mask = _ink_mask(_gray(image))
    if mask is None:
        return []
    runs = _trim_bleed(_merge_touching(_runs(mask)))
    chunks = []
    for start, end in runs:
        glyph = mask[:, start:end + 1]
        rows = np.where(glyph.sum(axis=1) > 0)[0]
        if rows.size == 0:
            continue
        chunks.append(glyph[rows.min():rows.max() + 1, :])
    return chunks


_MASK_CACHE = {}


def _render_mask(text, height, font_path=None):
    key = (text, int(height), font_path)
    cached = _MASK_CACHE.get(key)
    if cached is not None:
        return cached
    rendered = _render_mask_uncached(text, height, font_path)
    _MASK_CACHE[key] = rendered
    return rendered


def _render_mask_uncached(text, height, font_path=None):
    from PIL import Image, ImageDraw, ImageFont

    path = font_path
    if not path:
        return None
    target = max(8, int(height))
    size = max(10, int(target * 1.4))
    font = ImageFont.truetype(path, size)
    probe = ImageDraw.Draw(Image.new("L", (8, 8)))
    box = probe.textbbox((0, 0), text, font=font)
    pad = 2
    width = max(1, box[2] - box[0] + pad * 2)
    canvas_h = max(1, box[3] - box[1] + pad * 2)
    image = Image.new("L", (width, canvas_h), 0)
    ImageDraw.Draw(image).text((pad - box[0], pad - box[1]), text, fill=255, font=font)
    array = np.asarray(image)
    ink = array >= 128
    rows = np.where(ink.sum(axis=1) > 0)[0]
    cols = np.where(ink.sum(axis=0) > 0)[0]
    if rows.size == 0 or cols.size == 0:
        return None
    cropped = ink[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    if cropped.shape[0] != target:
        resized = Image.fromarray((cropped.astype(np.uint8) * 255)).resize(
            (max(1, int(round(cropped.shape[1] * target / cropped.shape[0]))), target),
            Image.Resampling.NEAREST,
        )
        cropped = np.asarray(resized) >= 128
    return cropped


def _fit(mask, template):
    if mask is None or template is None or mask.size == 0 or template.size == 0:
        return -1.0
    from PIL import Image

    canvas = Image.fromarray((template.astype(np.uint8) * 255)).resize(
        (max(1, mask.shape[1]), max(1, mask.shape[0])),
        Image.Resampling.NEAREST,
    )
    fitted = np.asarray(canvas) >= 128
    if fitted.shape != mask.shape:
        return -1.0
    left = mask.astype(np.float32)
    right = fitted.astype(np.float32)
    left -= left.mean()
    right -= right.mean()
    denom = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denom < 1e-6:
        return -1.0
    return float(np.dot(left.ravel(), right.ravel()) / denom)


def _hole_count(mask):
    import cv2

    ink = (mask.astype(np.uint8) * 255)
    inverse = cv2.bitwise_not(ink)
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(inverse, connectivity=8)
    height, width = mask.shape
    holes = 0
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if x > 0 and y > 0 and x + w < width and y + h < height and area > 2:
            holes += 1
    return holes


def looks_like_digit_one(mask):
    """Madden '1' is a narrow stem on a full-width base. Font templates call it 2."""
    if mask is None or mask.size == 0:
        return False
    height, width = mask.shape
    if width <= 0 or height <= 0 or (width / float(height)) > 0.75:
        return False
    if _hole_count(mask) != 0:
        return False
    middle = mask[int(height * 0.35):int(height * 0.75)]
    bottom = mask[int(height * 0.82):]
    if middle.size == 0 or bottom.size == 0:
        return False
    middle_width = max(float(row.sum()) for row in middle) / float(width)
    bottom_width = max(float(row.sum()) for row in bottom) / float(width)
    return middle_width <= 0.62 and bottom_width >= 0.85


def _best(mask, labels):
    fonts = _font_paths()
    if not fonts:
        return None, -1.0, -1.0
    scored = []
    for label in labels:
        score = -1.0
        for font_path in fonts:
            score = max(score, _fit(mask, _render_mask(label, mask.shape[0], font_path=font_path)))
        scored.append((score, label))
    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_label = scored[0]
    second = scored[1][0] if len(scored) > 1 else -1.0
    return best_label, best_score, best_score - second


def read_down_distance(image):
    """Return a legal down-distance label, or None when the crop is ambiguous."""
    chunks = segment_down_distance(image)
    if len(chunks) != 3 or not _font_paths():
        return None
    ordinal, ordinal_score, ordinal_margin = _best(chunks[0], _ORDINALS)
    if looks_like_digit_one(chunks[-1]):
        yards, yard_score, yard_margin = "1", 0.9, 0.5
    else:
        yards, yard_score, yard_margin = _best(chunks[-1], _YARD_LABELS)
    if ordinal is None or yards is None:
        return None
    if ordinal_margin < _MIN_MARGIN or yard_margin < _MIN_MARGIN:
        return None
    if ordinal_score < _MIN_ORDINAL_SCORE or yard_score < _MIN_YARD_SCORE:
        return None
    down = ordinal[0]
    suffix = {"1": "ST", "2": "ND", "3": "RD", "4": "TH"}[down]
    margin = min(ordinal_margin, yard_margin)
    return {
        "text": f"{down}{suffix} & {yards}",
        "confidence": round(max(0.0, min(0.99, 0.8 + margin)), 4),
        "margin": round(margin, 4),
        "ordinal": ordinal,
        "yards": yards,
        "chunks": 3,
    }
