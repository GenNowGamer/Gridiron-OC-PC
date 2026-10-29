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
    """Map a YOLOv8 ONNX output onto top-left normalized boxes."""
    array = np.asarray(output)
    if array.ndim == 3 and array.shape[0] == 1:
        array = array[0]
    if array.ndim != 2:
        return []
    if array.shape[0] >= 5 and array.shape[1] > array.shape[0] and array.shape[1] != 6:
        array = array.T
    boxes = []
    if array.shape[1] == 6:
        rows = array
        for row in rows:
            x1, y1, x2, y2, score, class_id = [float(value) for value in row[:6]]
            boxes.append(
                _box_from_corners(
                    x1, y1, x2, y2, score, int(class_id),
                    scale, pad_x, pad_y, orig_w, orig_h, already_input=True,
                )
            )
    else:
        class_count = array.shape[1] - 4
        if class_count < 1:
            return []
        for row in array:
            scores = row[4:4 + class_count]
            class_id = int(np.argmax(scores))
            confidence = float(scores[class_id])
            cx, cy, bw, bh = [float(value) for value in row[:4]]
            if max(abs(cx), abs(cy), abs(bw), abs(bh)) <= 1.5:
                cx *= size
                cy *= size
                bw *= size
                bh *= size
            boxes.append(
                _box_from_corners(
                    cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2,
                    confidence, class_id, scale, pad_x, pad_y, orig_w, orig_h,
                    already_input=True,
                )
            )
    best = {}
    for box in boxes:
        if not box or box["confidence"] < SCORE_FLOOR:
            continue
        current = best.get(box["field"])
        if current is None or box["confidence"] > current["confidence"]:
            best[box["field"]] = box
    return list(best.values())


def _box_from_corners(x1, y1, x2, y2, score, class_id, scale, pad_x, pad_y, orig_w, orig_h, already_input):
    if class_id < 0 or class_id >= len(FIELD_CLASSES):
        return None
    if already_input:
        x1 = (x1 - pad_x) / scale
        y1 = (y1 - pad_y) / scale
        x2 = (x2 - pad_x) / scale
        y2 = (y2 - pad_y) / scale
    x1 = min(max(x1, 0.0), float(orig_w))
    y1 = min(max(y1, 0.0), float(orig_h))
    x2 = min(max(x2, 0.0), float(orig_w))
    y2 = min(max(y2, 0.0), float(orig_h))
    width = x2 - x1
    height = y2 - y1
    if width < 1 or height < 1 or orig_w < 1 or orig_h < 1:
        return None
    return {
        "field": FIELD_CLASSES[class_id],
        "x": x1 / orig_w,
        "y": y1 / orig_h,
        "width": width / orig_w,
        "height": height / orig_h,
        "confidence": float(score),
    }


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
