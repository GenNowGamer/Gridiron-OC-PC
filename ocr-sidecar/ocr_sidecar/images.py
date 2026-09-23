import base64
import binascii
import os

from .errors import SidecarError, unavailable

MAX_ENCODED_IMAGE_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 3840 * 2160


def _cv2():
    try:
        import cv2
        return cv2
    except Exception as exc:
        raise unavailable("opencv", exc) from exc


def decode_image_data(value):
    if not isinstance(value, str) or not value:
        raise SidecarError("invalid_params", "imageBase64 must be a non-empty string")
    encoded = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    if len(encoded) > MAX_ENCODED_IMAGE_BYTES * 4 // 3 + 8:
        raise SidecarError("input_too_large", "encoded image exceeds the 12 MiB limit")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise SidecarError("invalid_image", "imageBase64 is not valid base64") from exc
    if len(raw) > MAX_ENCODED_IMAGE_BYTES:
        raise SidecarError("input_too_large", "decoded image exceeds the 12 MiB limit")
    try:
        import numpy as np
    except Exception as exc:
        raise unavailable("numpy", exc) from exc
    image = _cv2().imdecode(np.frombuffer(raw, dtype=np.uint8), _cv2().IMREAD_COLOR)
    if image is None:
        raise SidecarError("invalid_image", "image data could not be decoded")
    if image.shape[0] * image.shape[1] > MAX_PIXELS:
        raise SidecarError("input_too_large", "image dimensions exceed 3840x2160")
    return image


def decode_image_path(path_value):
    if not isinstance(path_value, str) or not path_value.strip():
        raise SidecarError("invalid_params", "imagePath must be a non-empty string")
    path = os.path.abspath(path_value)
    if not os.path.isfile(path):
        raise SidecarError("invalid_image", "imagePath does not exist", {"path": path})
    size = os.path.getsize(path)
    if size > MAX_ENCODED_IMAGE_BYTES:
        raise SidecarError("input_too_large", "imagePath exceeds the 12 MiB limit")
    image = _cv2().imread(path, _cv2().IMREAD_COLOR)
    if image is None:
        raise SidecarError("invalid_image", "imagePath could not be decoded", {"path": path})
    if image.shape[0] * image.shape[1] > MAX_PIXELS:
        raise SidecarError("input_too_large", "image dimensions exceed 3840x2160")
    return image


def encode_png_data_url(image):
    ok, encoded = _cv2().imencode(".png", image)
    if not ok:
        raise SidecarError("capture_failed", "frame could not be encoded")
    return "data:image/png;base64," + base64.b64encode(encoded.tobytes()).decode("ascii")


def match_template_offset(frame, template, expected_xy=(0, 0)):
    """Return normalized (dx, dy, score) of template match vs expected top-left."""
    cv2 = _cv2()
    if frame is None or template is None or frame.size == 0 or template.size == 0:
        return {"dx": 0.0, "dy": 0.0, "score": 0.0, "matched": False}
    haystack = frame if len(frame.shape) == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    needle = template if len(template.shape) == 2 else cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
    if needle.shape[0] >= haystack.shape[0] or needle.shape[1] >= haystack.shape[1]:
        return {"dx": 0.0, "dy": 0.0, "score": 0.0, "matched": False}
    result = cv2.matchTemplate(haystack, needle, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    dx = (max_loc[0] - expected_xy[0]) / max(1, haystack.shape[1])
    dy = (max_loc[1] - expected_xy[1]) / max(1, haystack.shape[0])
    return {
        "dx": round(float(dx), 5),
        "dy": round(float(dy), 5),
        "score": round(float(max_val), 4),
        "matched": float(max_val) >= 0.55,
    }


def estimate_anchor_drift(frame, anchors, reference_frame=None, max_shift=0.035):
    """Bounded drift correction from optional calibration anchors via template matching."""
    if not anchors:
        return {"dx": 0.0, "dy": 0.0, "score": 1.0, "rejected": False, "anchors": []}
    from .profile import crop_normalized

    samples = []
    height, width = frame.shape[:2]
    for anchor in anchors:
        template = None
        if anchor.get("templateImageBase64"):
            try:
                template = decode_image_data(anchor["templateImageBase64"])
            except SidecarError:
                template = None
        if template is None and reference_frame is not None:
            template = crop_normalized(reference_frame, anchor)
        if template is None:
            template = crop_normalized(frame, anchor)
        pad_x = max(1, int(anchor["width"] * width * 0.5))
        pad_y = max(1, int(anchor["height"] * height * 0.5))
        x1 = max(0, round(anchor["x"] * width) - pad_x)
        y1 = max(0, round(anchor["y"] * height) - pad_y)
        x2 = min(width, round((anchor["x"] + anchor["width"]) * width) + pad_x)
        y2 = min(height, round((anchor["y"] + anchor["height"]) * height) + pad_y)
        window = frame[y1:y2, x1:x2]
        expected_local = (round(anchor["x"] * width) - x1, round(anchor["y"] * height) - y1)
        match = match_template_offset(window, template, expected_xy=expected_local)
        # Convert window-normalized delta into full-frame normalized delta.
        dx = match["dx"] * (window.shape[1] / max(1, width))
        dy = match["dy"] * (window.shape[0] / max(1, height))
        samples.append({
            "id": anchor.get("id"),
            "dx": round(dx, 5),
            "dy": round(dy, 5),
            "score": match["score"],
        })
    if not samples:
        return {"dx": 0.0, "dy": 0.0, "score": 0.0, "rejected": False, "anchors": []}
    dx = sum(item["dx"] for item in samples) / len(samples)
    dy = sum(item["dy"] for item in samples) / len(samples)
    score = sum(item["score"] for item in samples) / len(samples)
    shift = (dx * dx + dy * dy) ** 0.5
    rejected = shift > float(max_shift) or score < 0.45
    clamp = float(max_shift)
    return {
        "dx": round(max(-clamp, min(clamp, dx)), 5),
        "dy": round(max(-clamp, min(clamp, dy)), 5),
        "score": round(score, 4),
        "rejected": rejected,
        "anchors": samples,
    }


def shift_roi(roi, dx, dy):
    next_roi = dict(roi)
    next_roi["x"] = max(0.0, min(1.0 - float(roi["width"]), float(roi["x"]) + float(dx)))
    next_roi["y"] = max(0.0, min(1.0 - float(roi["height"]), float(roi["y"]) + float(dy)))
    return next_roi


def detect_field_side_arrow(image):
    """
    Detect Madden TNF field-side arrow in a field_position crop.

    Convention (user-confirmed for TNF):
      down arrow -> OWN
      up arrow   -> OPP

    The arrow shares the crop with yard digits. Do not pick the largest blob —
    score every contour for triangle shape and prefer left-of-digits geometry.
    """
    import numpy as np

    cv2 = _cv2()
    if image is None or getattr(image, "size", 0) == 0:
        return {"side": None, "direction": None, "confidence": 0.0}
    gray = image if len(image.shape) == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    if height < 4 or width < 4:
        return {"side": None, "direction": None, "confidence": 0.0}

    # Arrow sits left of the yard digits. Search left third, left half, then full.
    # Do not early-exit on left-third alone — aggressive crops can clip the triangle
    # and invert taper (wide base cut off → false OPP/OWN).
    left_third = max(2, width // 3)
    left_half = max(2, width // 2)
    regions = [
        (gray[:, :left_third], 1.12, False),
        (gray[:, :left_half], 1.08, True),
        (gray, 1.0, True),
    ]
    best = {"side": None, "direction": None, "confidence": 0.0}
    for region, region_boost, allow_early_exit in regions:
        scored = _score_field_side_arrow(region, cv2, np, region_boost=region_boost)
        if float(scored.get("confidence") or 0) > float(best.get("confidence") or 0):
            best = scored
        if allow_early_exit and float(best.get("confidence") or 0) >= 0.78:
            break
    return best


def _score_field_side_arrow(gray, cv2, np, region_boost=1.0):
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binaries = []
    for binary in (otsu, cv2.bitwise_not(otsu)):
        ratio = float(np.count_nonzero(binary)) / float(binary.size)
        # Digits + arrow can cover more of a tight left strip than 0.55.
        if ratio < 0.01 or ratio > 0.72:
            continue
        binaries.append(binary)
    if not binaries:
        return {"side": None, "direction": None, "confidence": 0.0}

    region_h, region_w = gray.shape[:2]
    region_area = float(max(1, region_h * region_w))
    best = {"side": None, "direction": None, "confidence": 0.0}

    for binary in binaries:
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        # Evaluate every contour — yard digits are usually the largest blob.
        ranked = sorted(contours, key=cv2.contourArea, reverse=True)
        for contour in ranked[:16]:
            candidate = _score_arrow_contour(
                contour, binary, region_w, region_area, cv2, np, region_boost=region_boost
            )
            if candidate and candidate["confidence"] > best["confidence"]:
                best = candidate
    return best


def _score_arrow_contour(contour, binary, region_w, region_area, cv2, np, region_boost=1.0):
    area = float(cv2.contourArea(contour))
    if area < 6:
        return None
    # Digits dominate area; reject blobs that are most of the crop.
    if area > region_area * 0.42:
        return None
    x, y, w, h = cv2.boundingRect(contour)
    if w < 2 or h < 3:
        return None
    # Contours flush with the right edge of a left search window are usually
    # clipped arrows/digits — their taper sign is unreliable.
    if x + w >= region_w - 1:
        return None
    aspect = h / max(1.0, float(w))
    # TNF arrows are taller than wide; reject wide digit slabs.
    if aspect < 0.7 or aspect > 5.0:
        return None

    mask = np.zeros(binary.shape, dtype=np.uint8)
    cv2.drawContours(mask, [contour], -1, 255, thickness=-1)
    ys, xs = np.where(mask > 0)
    if ys.size == 0:
        return None
    com_y = float(ys.mean())
    mid_y = y + (h / 2.0)
    # Mass above midpoint => down-pointing triangle; below => up-pointing.
    mass_bias = (mid_y - com_y) / max(1.0, float(h))

    widths = []
    for row in range(y, y + h):
        cols = np.where(mask[row] > 0)[0]
        widths.append(float(cols.max() - cols.min() + 1) if cols.size else 0.0)
    if len(widths) < 3:
        return None
    third = max(1, len(widths) // 3)
    top = sum(widths[:third]) / third
    bottom = sum(widths[-third:]) / third
    taper = (top - bottom) / max(1.0, max(top, bottom))

    # Monotonic taper check: down arrows shrink top→bottom; up grow top→bottom.
    mid_slice = widths[third: 2 * third]
    mid = (sum(mid_slice) / len(mid_slice)) if mid_slice else ((top + bottom) / 2.0)
    if taper > 0.12:
        taper_consistency = 1.0 if top >= mid >= bottom * 0.85 else 0.55
    elif taper < -0.12:
        taper_consistency = 1.0 if bottom >= mid >= top * 0.85 else 0.55
    else:
        taper_consistency = 0.35

    # Approx polygon: true arrows are ~3 vertices; digits are more complex.
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.06 * peri, True)
    vertex_count = len(approx)
    if vertex_count <= 4:
        vertex_score = 1.0
    elif vertex_count <= 6:
        vertex_score = 0.65
    else:
        vertex_score = 0.25

    fill = area / max(1.0, float(w * h))
    # Triangles fill ~0.4–0.6 of their bbox; reject hollow/complex digit ink.
    if fill < 0.28 or fill > 0.82:
        return None

    shape_score = (mass_bias * 0.5) + (taper * 0.5)
    if abs(shape_score) < 0.1:
        return None

    # Prefer left-of-crop geometry (arrow before yard digits).
    center_x = x + (w / 2.0)
    leftness = 1.0 - min(1.0, center_x / max(1.0, float(region_w)))
    size_norm = min(1.0, area / max(24.0, region_area * 0.08))

    confidence = abs(shape_score) * 0.9
    confidence += min(0.18, fill * 0.22)
    confidence += 0.16 * leftness
    confidence += 0.1 * vertex_score
    confidence += 0.08 * taper_consistency
    confidence += 0.04 * size_norm
    confidence *= float(region_boost or 1.0)
    confidence = min(0.98, confidence)
    if confidence < 0.40:
        return None

    if shape_score > 0.1:
        direction, side = "down", "OWN"
    elif shape_score < -0.1:
        direction, side = "up", "OPP"
    else:
        return None

    return {
        "side": side,
        "direction": direction,
        "confidence": round(float(confidence), 4),
    }


def expand_roi_band(roi, pad_x=0.35, pad_y=0.3):
    """Widen a normalized ROI into a modest search band for HUD text localization.

    Keep padding conservative so scoreboard chrome (quarter/clock/scores) is less
    likely to outscore the intended down/field glyphs.
    """
    x = float(roi.get("x") or 0)
    y = float(roi.get("y") or 0)
    width = max(0.001, float(roi.get("width") or 0))
    height = max(0.001, float(roi.get("height") or 0))
    grow_x = width * float(pad_x)
    grow_y = height * float(pad_y)
    left = max(0.0, x - grow_x * 0.45)
    top = max(0.0, y - grow_y * 0.4)
    right = min(1.0, x + width + grow_x * 0.55)
    bottom = min(1.0, y + height + grow_y * 0.6)
    return {
        "id": roi.get("id"),
        "x": left,
        "y": top,
        "width": max(0.001, right - left),
        "height": max(0.001, bottom - top),
        "preprocess": roi.get("preprocess") or {},
        "ocr": roi.get("ocr") or {},
    }


def locate_hud_text_crops(band_image, max_crops=4):
    """
    Find compact high-energy text strips inside an expanded HUD band.

    Returns BGR/gray crops ranked by text-likeness. Always includes the full
    band as a fallback candidate so empty localization never drops the ROI.
    """
    import numpy as np

    cv2 = _cv2()
    if band_image is None or getattr(band_image, "size", 0) == 0:
        return []
    gray = band_image if len(band_image.shape) == 2 else cv2.cvtColor(band_image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    crops = [{"image": band_image, "score": 0.35, "source": "band_full"}]
    if height < 8 or width < 12:
        return crops

    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3)
    energy = np.abs(edges).sum(axis=1)
    if float(energy.max()) <= 1e-6:
        return crops
    normalized = energy / float(energy.max())
    threshold = max(0.22, float(np.percentile(normalized, 70)) * 0.85)

    # Collect contiguous high-energy horizontal rows (text lines).
    active = normalized >= threshold
    segments = []
    start = None
    for index, flag in enumerate(active.tolist()):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            segments.append((start, index - 1))
            start = None
    if start is not None:
        segments.append((start, height - 1))

    ranked = []
    for y0, y1 in segments:
        span = y1 - y0 + 1
        if span < max(4, int(height * 0.12)) or span > int(height * 0.85):
            continue
        pad = max(1, int(span * 0.2))
        top = max(0, y0 - pad)
        bottom = min(height, y1 + pad + 1)
        strip = gray[top:bottom, :]
        # Trim quiet left/right margins so digits/arrows dominate the crop.
        col_energy = np.abs(cv2.Sobel(strip, cv2.CV_32F, 1, 0, ksize=3)).sum(axis=0)
        if float(col_energy.max()) <= 1e-6:
            continue
        col_norm = col_energy / float(col_energy.max())
        cols = np.where(col_norm >= 0.18)[0]
        if cols.size < 4:
            continue
        left = max(0, int(cols[0]) - 2)
        right = min(width, int(cols[-1]) + 3)
        crop = band_image[top:bottom, left:right]
        if crop.size == 0 or crop.shape[0] < 4 or crop.shape[1] < 6:
            continue
        score = float(normalized[y0:y1 + 1].mean()) * (1.0 + min(1.5, span / max(1.0, height)))
        ranked.append({"image": crop, "score": score, "source": "band_strip"})

    ranked.sort(key=lambda item: item["score"], reverse=True)
    for item in ranked[: max(0, int(max_crops) - 1)]:
        crops.append(item)
    return crops


def preprocess(image, options):
    cv2 = _cv2()
    result = image
    if options["grayscale"] and len(result.shape) == 3:
        result = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
    if options["scale"] != 1:
        result = cv2.resize(
            result, None, fx=options["scale"], fy=options["scale"], interpolation=cv2.INTER_CUBIC
        )
    if options["blur"] > 1:
        result = cv2.GaussianBlur(result, (options["blur"], options["blur"]), 0)
    threshold = options["threshold"]
    if threshold != "none":
        if len(result.shape) == 3:
            result = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
        if threshold == "otsu":
            _, result = cv2.threshold(result, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        elif threshold == "binary":
            _, result = cv2.threshold(
                result, options["thresholdValue"], 255, cv2.THRESH_BINARY
            )
        else:
            result = cv2.adaptiveThreshold(
                result, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
            )
    if options["invert"]:
        result = cv2.bitwise_not(result)
    if options["morphology"] != "none":
        import numpy as np
        kernel = np.ones((options["kernel"], options["kernel"]), np.uint8)
        operation = cv2.MORPH_OPEN if options["morphology"] == "open" else cv2.MORPH_CLOSE
        result = cv2.morphologyEx(result, operation, kernel)
    return result
