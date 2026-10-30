"""YOLO-format ONNX detector for the Madden play-call HUD.

The model file is produced by scripts/train-playcall-detector.py and is not
bundled. A missing file returns trained=False so capture can keep using F8.
"""

import os

import numpy as np

FIELD_CLASSES = (
    "down_distance",
    "field_position",
    "offense_formation_personnel",
    "previous_offense_play",
    "previous_defense_play",
)
INPUT_SIZE = 640
SCORE_FLOOR = 0.25
CONFIDENCE_BAR = 0.75


def _not_trained(reason="not_trained", detail=None):
    result = {"trained": False, "reason": reason, "boxes": [], "playCall": False}
    if detail:
        result["detail"] = detail
    return result


def input_size_from_shape(shape, fallback=INPUT_SIZE):
    """Square side length declared by an ONNX input. Dynamic shapes keep the fallback."""
    if not shape or len(shape) < 4:
        return fallback
    height, width = shape[2], shape[3]
    if isinstance(height, int) and isinstance(width, int) and height > 0 and width > 0:
        return int(max(height, width))
    return fallback


def letterbox(image, size=INPUT_SIZE):
    import cv2
    height, width = image.shape[:2]
    scale = min(size / max(1, height), size / max(1, width))
    resized_w = max(1, int(round(width * scale)))
    resized_h = max(1, int(round(height * scale)))
    resized = cv2.resize(image, (resized_w, resized_h), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    pad_x = (size - resized_w) // 2
    pad_y = (size - resized_h) // 2
    canvas[pad_y:pad_y + resized_h, pad_x:pad_x + resized_w] = resized
    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    chw = np.transpose(rgb, (2, 0, 1))[None, ...]
    return chw, scale, pad_x, pad_y, width, height


def parse_predictions(output, scale, pad_x, pad_y, orig_w, orig_h, size=INPUT_SIZE):
    """Map a YOLOv8 ONNX output onto top-left normalized boxes.

    A 1280-pixel model emits tens of thousands of anchors. Score them as arrays
    so a live probe finishes inside the sidecar request budget.
    """
    array = np.asarray(output)
    if array.ndim == 3 and array.shape[0] == 1:
        array = array[0]
    if array.ndim != 2 or array.shape[0] == 0:
        return []
    if array.shape[0] >= 5 and array.shape[1] > array.shape[0] and array.shape[1] != 6:
        array = array.T
    if array.shape[1] == 6:
        return _best_boxes(
            array[:, 5],
            array[:, 4],
            array[:, :4],
            scale, pad_x, pad_y, orig_w, orig_h,
        )
    class_count = int(array.shape[1]) - 4
    if class_count < 1:
        return []
    scores = array[:, 4:4 + class_count]
    class_ids = np.argmax(scores, axis=1)
    confidence = scores[np.arange(array.shape[0]), class_ids]
    xywh = array[:, :4].astype(np.float64, copy=True)
    normalized = np.max(np.abs(xywh), axis=1) <= 1.5
    if np.any(normalized):
        xywh[normalized] *= float(size)
    cx = xywh[:, 0]
    cy = xywh[:, 1]
    half_w = xywh[:, 2] / 2
    half_h = xywh[:, 3] / 2
    corners = np.stack((cx - half_w, cy - half_h, cx + half_w, cy + half_h), axis=1)
    return _best_boxes(class_ids, confidence, corners, scale, pad_x, pad_y, orig_w, orig_h)


def _best_boxes(class_ids, confidence, corners, scale, pad_x, pad_y, orig_w, orig_h):
    """Keep the highest-confidence valid box for each field, in first-seen order."""
    class_ids = np.trunc(np.asarray(class_ids, dtype=np.float64)).astype(np.int64)
    confidence = np.asarray(confidence, dtype=np.float64)
    corners = np.asarray(corners, dtype=np.float64)
    if class_ids.size == 0 or orig_w < 1 or orig_h < 1:
        return []
    scale = float(scale)
    if scale == 0:
        return []
    x1 = np.clip((corners[:, 0] - pad_x) / scale, 0.0, float(orig_w))
    y1 = np.clip((corners[:, 1] - pad_y) / scale, 0.0, float(orig_h))
    x2 = np.clip((corners[:, 2] - pad_x) / scale, 0.0, float(orig_w))
    y2 = np.clip((corners[:, 3] - pad_y) / scale, 0.0, float(orig_h))
    width = x2 - x1
    height = y2 - y1
    valid = (
        (class_ids >= 0)
        & (class_ids < len(FIELD_CLASSES))
        & (confidence >= SCORE_FLOOR)
        & (width >= 1)
        & (height >= 1)
    )
    if not np.any(valid):
        return []
    indexes = np.flatnonzero(valid)
    winners = []
    for class_index in range(len(FIELD_CLASSES)):
        chosen = indexes[class_ids[indexes] == class_index]
        if chosen.size == 0:
            continue
        best = int(chosen[int(np.argmax(confidence[chosen]))])
        winners.append((int(chosen[0]), best, class_index))
    winners.sort(key=lambda item: item[0])
    origin_w = float(orig_w)
    origin_h = float(orig_h)
    return [
        {
            "field": FIELD_CLASSES[class_index],
            "x": float(x1[index] / origin_w),
            "y": float(y1[index] / origin_h),
            "width": float(width[index] / origin_w),
            "height": float(height[index] / origin_h),
            "confidence": float(confidence[index]),
        }
        for _first, index, class_index in winners
    ]


def play_call_ready(boxes):
    by_field = {box["field"]: box for box in boxes}
    needed = ("down_distance", "field_position")
    return all(
        field in by_field and by_field[field]["confidence"] >= CONFIDENCE_BAR
        for field in needed
    )


class ScreenDetector:
    def __init__(self):
        self._session = None
        self._path = None
        self._input_name = None
        self._input_size = INPUT_SIZE

    def detect(self, image, model_path):
        path = os.path.abspath(model_path) if isinstance(model_path, str) and model_path.strip() else ""
        if not path or not os.path.isfile(path):
            return _not_trained()
        try:
            session, input_name, size = self._session_for(path)
            blob, scale, pad_x, pad_y, width, height = letterbox(image, size)
            output = session.run(None, {input_name: blob})[0]
            boxes = parse_predictions(output, scale, pad_x, pad_y, width, height, size)
        except Exception as exc:
            return _not_trained("model_load_failed", str(exc))
        return {
            "trained": True,
            "reason": None,
            "boxes": boxes,
            "playCall": play_call_ready(boxes),
        }

    def _session_for(self, path):
        if self._session is not None and self._path == path:
            return self._session, self._input_name, self._input_size
        import onnxruntime as ort
        providers = []
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            providers.append("CUDAExecutionProvider")
        providers.append("CPUExecutionProvider")
        session = ort.InferenceSession(path, providers=providers)
        self._session = session
        self._path = path
        self._input_name = session.get_inputs()[0].name
        self._input_size = input_size_from_shape(session.get_inputs()[0].shape)
        return session, self._input_name, self._input_size
