import re

from .errors import SidecarError

MAX_ROIS = 32
MAX_PROFILE_NAME = 80
_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def _bounded_number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SidecarError("invalid_params", f"{name} must be a number")
    value = float(value)
    if not low <= value <= high:
        raise SidecarError("invalid_params", f"{name} must be between {low} and {high}")
    return value


def validate_profile(value):
    if not isinstance(value, dict):
        raise SidecarError("invalid_params", "profile must be an object")
    name = value.get("name", "unnamed")
    if not isinstance(name, str) or not 1 <= len(name) <= MAX_PROFILE_NAME:
        raise SidecarError("invalid_params", "profile.name must be 1-80 characters")
    rois = value.get("rois")
    if not isinstance(rois, list) or not 1 <= len(rois) <= MAX_ROIS:
        raise SidecarError("invalid_params", f"profile.rois must contain 1-{MAX_ROIS} items")

    normalized = []
    seen = set()
    for index, roi in enumerate(rois):
        if not isinstance(roi, dict):
            raise SidecarError("invalid_params", f"profile.rois[{index}] must be an object")
        roi_id = roi.get("id")
        if not isinstance(roi_id, str) or not _ID_RE.fullmatch(roi_id):
            raise SidecarError("invalid_params", f"profile.rois[{index}].id is invalid")
        if roi_id in seen:
            raise SidecarError("invalid_params", f"duplicate ROI id: {roi_id}")
        seen.add(roi_id)
        x = _bounded_number(roi.get("x"), f"{roi_id}.x", 0, 1)
        y = _bounded_number(roi.get("y"), f"{roi_id}.y", 0, 1)
        width = _bounded_number(roi.get("width"), f"{roi_id}.width", 0.0001, 1)
        height = _bounded_number(roi.get("height"), f"{roi_id}.height", 0.0001, 1)
        if x + width > 1.000001 or y + height > 1.000001:
            raise SidecarError("invalid_params", f"ROI {roi_id} extends outside the frame")
        normalized.append(
            {
                "id": roi_id,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "preprocess": validate_preprocess(roi.get("preprocess", {}), roi_id),
                "ocr": validate_ocr_options(roi.get("ocr", {}), roi_id),
            }
        )
    anchors = validate_anchors(value.get("anchors", []))
    presentation = value.get("presentation", "")
    if presentation is None:
        presentation = ""
    if not isinstance(presentation, str) or len(presentation) > 120:
        raise SidecarError("invalid_params", "profile.presentation must be a string up to 120 characters")
    reference_image = value.get("referenceImageBase64")
    if reference_image is not None and (not isinstance(reference_image, str) or len(reference_image) > MAX_ENCODED_REF):
        raise SidecarError("invalid_params", "profile.referenceImageBase64 is invalid")
    result = {"name": name, "rois": normalized, "anchors": anchors, "presentation": presentation}
    if reference_image:
        result["referenceImageBase64"] = reference_image
    return result


MAX_ENCODED_REF = 12 * 1024 * 1024 * 4 // 3 + 64
MAX_ANCHORS = 8


def validate_anchors(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_ANCHORS:
        raise SidecarError("invalid_params", f"profile.anchors must be a list of up to {MAX_ANCHORS} items")
    anchors = []
    seen = set()
    for index, anchor in enumerate(value):
        if not isinstance(anchor, dict):
            raise SidecarError("invalid_params", f"profile.anchors[{index}] must be an object")
        anchor_id = anchor.get("id", f"anchor_{index + 1}")
        if not isinstance(anchor_id, str) or not _ID_RE.fullmatch(anchor_id):
            raise SidecarError("invalid_params", f"profile.anchors[{index}].id is invalid")
        if anchor_id in seen:
            raise SidecarError("invalid_params", f"duplicate anchor id: {anchor_id}")
        seen.add(anchor_id)
        x = _bounded_number(anchor.get("x"), f"{anchor_id}.x", 0, 1)
        y = _bounded_number(anchor.get("y"), f"{anchor_id}.y", 0, 1)
        width = _bounded_number(anchor.get("width"), f"{anchor_id}.width", 0.0001, 1)
        height = _bounded_number(anchor.get("height"), f"{anchor_id}.height", 0.0001, 1)
        if x + width > 1.000001 or y + height > 1.000001:
            raise SidecarError("invalid_params", f"anchor {anchor_id} extends outside the frame")
        entry = {"id": anchor_id, "x": x, "y": y, "width": width, "height": height}
        template = anchor.get("templateImageBase64")
        if template is not None:
            if not isinstance(template, str) or not template or len(template) > MAX_ENCODED_REF:
                raise SidecarError("invalid_params", f"{anchor_id}.templateImageBase64 is invalid")
            entry["templateImageBase64"] = template
        anchors.append(entry)
    return anchors


def validate_preprocess(value, roi_id):
    if not isinstance(value, dict):
        raise SidecarError("invalid_params", f"{roi_id}.preprocess must be an object")
    allowed = {
        "grayscale", "scale", "invert", "threshold", "thresholdValue",
        "blur", "morphology", "kernel",
    }
    unknown = set(value) - allowed
    if unknown:
        raise SidecarError("invalid_params", f"unsupported preprocessing option: {sorted(unknown)[0]}")
    threshold = value.get("threshold", "none")
    if threshold not in ("none", "otsu", "binary", "adaptive"):
        raise SidecarError("invalid_params", f"{roi_id}.threshold is invalid")
    morphology = value.get("morphology", "none")
    if morphology not in ("none", "open", "close"):
        raise SidecarError("invalid_params", f"{roi_id}.morphology is invalid")
    blur = int(_bounded_number(value.get("blur", 1), f"{roi_id}.blur", 1, 15))
    kernel = int(_bounded_number(value.get("kernel", 3), f"{roi_id}.kernel", 1, 9))
    if blur % 2 == 0 or kernel % 2 == 0:
        raise SidecarError("invalid_params", f"{roi_id}.blur and kernel must be odd")
    return {
        "grayscale": bool(value.get("grayscale", True)),
        "scale": _bounded_number(value.get("scale", 1), f"{roi_id}.scale", 1, 6),
        "invert": bool(value.get("invert", False)),
        "threshold": threshold,
        "thresholdValue": int(
            _bounded_number(value.get("thresholdValue", 128), f"{roi_id}.thresholdValue", 0, 255)
        ),
        "blur": blur,
        "morphology": morphology,
        "kernel": kernel,
    }


def validate_ocr_options(value, roi_id):
    if not isinstance(value, dict):
        raise SidecarError("invalid_params", f"{roi_id}.ocr must be an object")
    allowed = {"language", "psm", "whitelist", "mockText", "mockConfidence"}
    unknown = set(value) - allowed
    if unknown:
        raise SidecarError("invalid_params", f"unsupported OCR option: {sorted(unknown)[0]}")
    language = value.get("language", "eng")
    whitelist = value.get("whitelist", "")
    if not isinstance(language, str) or not 1 <= len(language) <= 24:
        raise SidecarError("invalid_params", f"{roi_id}.ocr.language is invalid")
    if not isinstance(whitelist, str) or len(whitelist) > 128:
        raise SidecarError("invalid_params", f"{roi_id}.ocr.whitelist is invalid")
    psm = int(_bounded_number(value.get("psm", 7), f"{roi_id}.ocr.psm", 3, 13))
    mock_text = value.get("mockText", "")
    if not isinstance(mock_text, str) or len(mock_text) > 512:
        raise SidecarError("invalid_params", f"{roi_id}.ocr.mockText is invalid")
    return {
        "language": language,
        "psm": psm,
        "whitelist": whitelist,
        "mockText": mock_text,
        "mockConfidence": _bounded_number(
            value.get("mockConfidence", 1.0), f"{roi_id}.ocr.mockConfidence", 0, 1
        ),
    }


def crop_normalized(image, roi):
    if image is None or not hasattr(image, "shape") or len(image.shape) < 2:
        raise SidecarError("invalid_image", "decoded frame has no image dimensions")
    height, width = image.shape[:2]
    x1 = max(0, min(width - 1, round(roi["x"] * width)))
    y1 = max(0, min(height - 1, round(roi["y"] * height)))
    x2 = max(x1 + 1, min(width, round((roi["x"] + roi["width"]) * width)))
    y2 = max(y1 + 1, min(height, round((roi["y"] + roi["height"]) * height)))
    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        raise SidecarError("invalid_params", f"ROI {roi['id']} produces an empty crop")
    return crop
