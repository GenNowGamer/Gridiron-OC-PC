"""Train the play-call screen detector from a training-mode dataset.

Ultralytics is a train-time tool. It is not part of the Gridiron OC installer.
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import time

FIELD_CLASSES = (
    "down_distance",
    "field_position",
    "offense_formation_personnel",
    "previous_offense_play",
    "previous_defense_play",
)


def _install_checkpoint_save():
    """Retry checkpoint writes, then save through a real file.

    On this PC, torch.save into a memory buffer raises
    "ValueError: I/O operation on closed file" partway through training.
    Ultralytics only retries RuntimeError, so the run dies and no ONNX is written.
    """
    import torch
    import ultralytics.utils.patches as patches

    original = patches._torch_save

    def save(obj, target, *args, **kwargs):
        buffer = target if hasattr(target, "getvalue") and hasattr(target, "seek") else None
        attempts = 3 if buffer is not None else 1
        last_error = None
        for attempt in range(attempts):
            try:
                if buffer is not None:
                    buffer.seek(0)
                    buffer.truncate(0)
                return original(obj, target, *args, **kwargs)
            except (ValueError, RuntimeError, OSError) as exc:
                last_error = exc
                if buffer is None or attempt == attempts - 1:
                    break
                time.sleep(0.5 * (attempt + 1))
        if buffer is None:
            raise last_error
        fd, path = tempfile.mkstemp(prefix="gridiron-ckpt-", suffix=".pt")
        os.close(fd)
        try:
            original(obj, path, *args, **kwargs)
            with open(path, "rb") as handle:
                payload = handle.read()
        finally:
            try:
                os.remove(path)
            except OSError:
                pass
        buffer.seek(0)
        buffer.truncate(0)
        buffer.write(payload)
        return None

    patches._torch_save = save


def _base_weights():
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(here, "yolov8n.pt"), os.path.join(here, "..", "yolov8n.pt")):
        if os.path.isfile(path):
            return os.path.abspath(path)
    return "yolov8n.pt"


def _load_ultralytics():
    try:
        from ultralytics import YOLO
        return YOLO
    except Exception:
        print(
            "Install the train-time tool, then run Train detector again: py -3 -m pip install ultralytics",
            file=sys.stderr,
        )
        return None


def _boxes_to_yolo(boxes):
    lines = []
    for box in boxes or []:
        field = str(box.get("field") or "")
        if field not in FIELD_CLASSES:
            continue
        x = float(box.get("x") or 0)
        y = float(box.get("y") or 0)
        width = float(box.get("width") or 0)
        height = float(box.get("height") or 0)
        if min(x, y, width, height) < 0 or x + width > 1.01 or y + height > 1.01 or width <= 0 or height <= 0:
            continue
        cx = min(1.0, max(0.0, x + width / 2))
        cy = min(1.0, max(0.0, y + height / 2))
        lines.append(
            f"{FIELD_CLASSES.index(field)} {cx:.6f} {cy:.6f} {width:.6f} {height:.6f}"
        )
    return "\n".join(lines)


def stage_dataset(dataset, staging):
    meta_dir = os.path.join(dataset, "meta")
    image_dir = os.path.join(dataset, "images")
    if not os.path.isdir(meta_dir):
        raise SystemExit("No training samples yet. Turn on training mode and press F8 on a play-call screen.")
    out_images = os.path.join(staging, "images")
    out_labels = os.path.join(staging, "labels")
    os.makedirs(out_images, exist_ok=True)
    os.makedirs(out_labels, exist_ok=True)
    positives = 0
    negatives = 0
    for name in os.listdir(meta_dir):
        if not name.endswith(".json"):
            continue
        meta_path = os.path.join(meta_dir, name)
        try:
            with open(meta_path, "r", encoding="utf-8") as handle:
                meta = json.load(handle)
        except FileNotFoundError:
            continue
        label = meta.get("label")
        if label not in ("play-call", "other"):
            continue
        image_name = f"{meta.get('id') or os.path.splitext(name)[0]}.jpg"
        source = os.path.join(image_dir, image_name)
        if not os.path.isfile(source):
            continue
        shutil.copyfile(source, os.path.join(out_images, image_name))
        text = _boxes_to_yolo(meta.get("boxes")) if label == "play-call" else ""
        with open(os.path.join(out_labels, os.path.splitext(image_name)[0] + ".txt"), "w", encoding="utf-8") as handle:
            handle.write(text)
        if label == "play-call":
            positives += 1
        else:
            negatives += 1
    if positives < 1 or negatives < 1:
        raise SystemExit(
            f"Record at least one F8 play-call screen and one other screen before training. Found {positives} play-call and {negatives} other."
        )
    names = "\n".join(f"  {index}: {name}" for index, name in enumerate(FIELD_CLASSES))
    data_yaml = os.path.join(staging, "data.yaml")
    with open(data_yaml, "w", encoding="utf-8") as handle:
        handle.write(
            f"path: {staging.replace(os.sep, '/')}\ntrain: images\nval: images\nnames:\n{names}\n"
        )
    return data_yaml, positives, negatives


def main():
    parser = argparse.ArgumentParser(description="Train the Gridiron OC play-call detector")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--imgsz", type=int, default=1280)
    args = parser.parse_args()
    yolo_cls = _load_ultralytics()
    if yolo_cls is None:
        return 2
    _install_checkpoint_save()
    dataset = os.path.abspath(args.dataset)
    output = os.path.abspath(args.output)
    staging = os.path.join(dataset, "yolo-stage")
    if os.path.isdir(staging):
        shutil.rmtree(staging)
    data_yaml, positives, negatives = stage_dataset(dataset, staging)
    print(f"Training on {positives} play-call frames and {negatives} other frames.")
    model = yolo_cls(_base_weights())
    project = os.path.join(staging, "runs")
    model.train(
        data=data_yaml,
        epochs=max(1, args.epochs),
        imgsz=args.imgsz,
        batch=8,
        mosaic=0.0,
        workers=0 if os.name == "nt" else 8,
        project=project,
        name="playcall",
        exist_ok=True,
        verbose=False,
    )
    best = os.path.join(project, "playcall", "weights", "best.pt")
    trained = yolo_cls(best if os.path.isfile(best) else model.trainer.best)
    os.makedirs(os.path.dirname(output), exist_ok=True)
    exported = trained.export(format="onnx", imgsz=args.imgsz, simplify=True)
    exported_path = exported if isinstance(exported, str) else str(exported)
    if not os.path.isfile(exported_path):
        raise SystemExit(f"ONNX export did not produce a file: {exported_path}")
    shutil.copyfile(exported_path, output)
    print(f"Saved detector to {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
