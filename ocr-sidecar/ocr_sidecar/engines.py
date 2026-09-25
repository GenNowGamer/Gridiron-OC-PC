import importlib.util
import os
import re
import sys
import threading
import time

from .errors import SidecarError


def _clean_text(value):
    text = str(value or "")
    try:
        import unicodedata

        # PP-OCRv5 Latin/digit HUD glyphs are often fullwidth; fold to ASCII.
        text = unicodedata.normalize("NFKC", text)
    except Exception:
        pass
    return re.sub(r"\s+", " ", text).strip()


def _parse_character_dict(yml_text):
    """Load PostProcess.character_dict entries without stripping ideographic space.

    Python str.strip() removes U+3000. The PP-OCRv5 dict starts with that
    character; dropping it shifts every subsequent class by +1 and turns
    MESH SPOT into NFTITQPU.
    """
    chars = []
    in_dict = False
    for raw_line in str(yml_text or "").splitlines(True):
        if not in_dict:
            if "character_dict:" in raw_line:
                in_dict = True
            continue
        # End of the list: a non-indented new YAML key.
        if raw_line.strip() and not raw_line[0].isspace() and not raw_line.lstrip().startswith("-"):
            break
        stripped_left = raw_line.lstrip(" \t")
        if not stripped_left.startswith("-"):
            if stripped_left.startswith("#") or not stripped_left.strip():
                continue
            break
        rest = stripped_left[1:]
        if rest.startswith(" "):
            rest = rest[1:]
        # Keep trailing spaces / U+3000; only drop the line ending.
        if rest.endswith("\r\n"):
            rest = rest[:-2]
        elif rest.endswith("\n") or rest.endswith("\r"):
            rest = rest[:-1]
        chars.append(rest)
    return chars


def _default_onnx_model_path():
    env = os.environ.get("GRIDIRON_OCR_ONNX_MODEL", "").strip()
    if env:
        return env
    candidates = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        candidates.append(os.path.join(exe_dir, "models", "PP-OCRv5_mobile_rec", "inference.onnx"))
        meipass = getattr(sys, "_MEIPASS", "")
        if meipass:
            candidates.append(os.path.join(meipass, "models", "PP-OCRv5_mobile_rec", "inference.onnx"))
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates.append(os.path.join(base, "models", "PP-OCRv5_mobile_rec", "inference.onnx"))
    for path in candidates:
        if os.path.isfile(path):
            return path
    return candidates[0] if candidates else ""


class MockEngine:
    name = "mock"

    def recognize(self, _image, options):
        return {
            "text": _clean_text(options.get("mockText", "")),
            "confidence": float(options.get("mockConfidence", 1.0)),
        }


class TesseractEngine:
    name = "tesseract"

    def __init__(self):
        import pytesseract
        self._api = pytesseract
        base = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else ""
        bundled = os.path.join(base, "tesseract", "tesseract.exe") if base else ""
        candidates = [
            bundled,
            os.environ.get("TESSERACT_CMD", ""),
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Tesseract-OCR", "tesseract.exe"),
        ]
        executable = next((item for item in candidates if item and os.path.isfile(item)), "")
        if executable:
            self._api.pytesseract.tesseract_cmd = executable
            tessdata = os.path.join(os.path.dirname(executable), "tessdata")
            if os.path.isdir(tessdata):
                os.environ.setdefault("TESSDATA_PREFIX", tessdata)

    def recognize(self, image, options):
        config = f"--psm {options['psm']}"
        if options["whitelist"]:
            config += f" -c tessedit_char_whitelist={options['whitelist']}"
        try:
            data = self._api.image_to_data(
                image,
                lang=options["language"],
                config=config,
                output_type=self._api.Output.DICT,
            )
        except Exception as exc:
            raise SidecarError(
                "ocr_failed", "Tesseract OCR failed", {"engine": self.name, "reason": str(exc)}
            ) from exc
        words, confidences = [], []
        for text, confidence in zip(data.get("text", []), data.get("conf", [])):
            text = _clean_text(text)
            try:
                confidence = float(confidence)
            except (TypeError, ValueError):
                confidence = -1
            if text:
                words.append(text)
                if confidence >= 0:
                    confidences.append(confidence / 100)
        if confidences:
            confidence = sum(confidences) / len(confidences)
        elif words:
            # image_to_data sometimes returns text with conf=-1 for every token.
            confidence = 0.82
        else:
            confidence = 0.0
        return {
            "text": " ".join(words),
            "confidence": float(confidence),
        }


class PaddleEngine:
    name = "paddleocr"

    def __init__(self):
        from paddleocr import PaddleOCR
        try:
            self._ocr = PaddleOCR(use_angle_cls=False, lang="en", show_log=False)
        except TypeError:
            self._ocr = PaddleOCR(use_textline_orientation=False, lang="en")

    def recognize(self, image, _options):
        try:
            result = self._ocr.ocr(image, cls=False)
        except TypeError:
            result = self._ocr.predict(image)
        except Exception as exc:
            raise SidecarError(
                "ocr_failed", "PaddleOCR failed", {"engine": self.name, "reason": str(exc)}
            ) from exc
        pairs = []
        for page in result or []:
            if isinstance(page, dict):
                texts = page.get("rec_texts", [])
                scores = page.get("rec_scores", [])
                pairs.extend(zip(texts, scores))
                continue
            for line in page or []:
                if isinstance(line, (list, tuple)) and len(line) >= 2:
                    value = line[1]
                    if isinstance(value, (list, tuple)) and len(value) >= 2:
                        pairs.append((value[0], value[1]))
        texts = [_clean_text(text) for text, _ in pairs if _clean_text(text)]
        scores = [float(score) for text, score in pairs if _clean_text(text)]
        return {
            "text": " ".join(texts),
            "confidence": sum(scores) / len(scores) if scores else 0.0,
        }


class OnnxPaddleRecEngine:
    """PP-OCRv5 mobile recognition via ONNX Runtime (CUDA then CPU).

    Model is not bundled. Fetch with scripts/fetch-pp-ocrv5-onnx.ps1 into
    ocr-sidecar/models/PP-OCRv5_mobile_rec/ (gitignored). Official HF card
    license: Apache-2.0 (PaddlePaddle/PP-OCRv5_mobile_rec_onnx).
    """

    name = "onnx_ppocrv5"

    def __init__(self, model_path=None):
        self.model_path = model_path or _default_onnx_model_path()
        if not os.path.isfile(self.model_path):
            raise SidecarError(
                "sidecar_unavailable",
                "ONNX PP-OCRv5 model is not present",
                {
                    "engine": self.name,
                    "modelPath": self.model_path,
                    "fetch": "powershell -File ocr-sidecar/scripts/fetch-pp-ocrv5-onnx.ps1",
                },
            )
        try:
            import onnxruntime as ort
        except Exception as exc:
            raise SidecarError(
                "sidecar_unavailable",
                "onnxruntime is not installed",
                {"engine": self.name, "reason": str(exc)},
            ) from exc
        providers = []
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            providers.append("CUDAExecutionProvider")
        providers.append("CPUExecutionProvider")
        try:
            self._session = ort.InferenceSession(self.model_path, providers=providers)
        except Exception as exc:
            raise SidecarError(
                "sidecar_unavailable",
                "failed to load ONNX PP-OCRv5 model",
                {"engine": self.name, "reason": str(exc), "modelPath": self.model_path},
            ) from exc
        self._input_name = self._session.get_inputs()[0].name
        self._charset = self._load_charset()

    def _load_charset(self):
        yml = os.path.join(os.path.dirname(self.model_path), "inference.yml")
        if not os.path.isfile(yml):
            return None
        try:
            text = open(yml, "r", encoding="utf-8").read()
        except OSError:
            return None
        chars = _parse_character_dict(text)
        return chars or None

    def _preprocess(self, image):
        import numpy as np
        import cv2

        if len(image.shape) == 2:
            bgr = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        else:
            bgr = image
        height, width = bgr.shape[:2]
        target_h = 48
        scale = target_h / max(1, height)
        target_w = max(1, min(320, int(round(width * scale))))
        resized = cv2.resize(bgr, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        mean = np.array([0.5, 0.5, 0.5], dtype=np.float32)
        std = np.array([0.5, 0.5, 0.5], dtype=np.float32)
        normalized = (rgb - mean) / std
        # NCHW
        tensor = np.transpose(normalized, (2, 0, 1))[None, ...].astype(np.float32)
        return tensor

    def _decode(self, output):
        import numpy as np

        # Common PP-OCR rec output: [N, T, C] logits or probabilities.
        logits = np.asarray(output[0] if isinstance(output, (list, tuple)) else output)
        if logits.ndim == 3:
            logits = logits[0]
        if logits.ndim != 2:
            return "", 0.0
        indices = logits.argmax(axis=1)
        probs = logits.max(axis=1)
        previous = -1
        chars = []
        scores = []
        blank = 0
        for index, score in zip(indices.tolist(), probs.tolist()):
            if index == blank or index == previous:
                previous = index
                continue
            previous = index
            if self._charset and 0 < index <= len(self._charset):
                chars.append(self._charset[index - 1])
                scores.append(float(score))
            elif not self._charset:
                # Without a charset map, expose empty text rather than garbage.
                continue
        text = _clean_text("".join(chars))
        confidence = sum(scores) / len(scores) if scores else 0.0
        return text, confidence

    def recognize(self, image, _options):
        try:
            tensor = self._preprocess(image)
            outputs = self._session.run(None, {self._input_name: tensor})
            text, confidence = self._decode(outputs)
            return {"text": text, "confidence": float(confidence)}
        except SidecarError:
            raise
        except Exception as exc:
            raise SidecarError(
                "ocr_failed", "ONNX PP-OCRv5 recognition failed", {"engine": self.name, "reason": str(exc)}
            ) from exc


class EngineRegistry:
    def __init__(self):
        self._cache = {}
        self._lock = threading.Lock()
        self._last_warm = None

    def available(self):
        onnx_model = os.path.isfile(_default_onnx_model_path())
        onnx_runtime = importlib.util.find_spec("onnxruntime") is not None
        return {
            "onnx_ppocrv5": onnx_runtime and onnx_model,
            "paddleocr": importlib.util.find_spec("paddleocr") is not None,
            "tesseract": importlib.util.find_spec("pytesseract") is not None,
            "mock": True,
        }

    def status(self):
        with self._lock:
            cached = sorted(self._cache.keys())
        return {
            "available": self.available(),
            "cached": cached,
            "lastWarm": dict(self._last_warm) if self._last_warm else None,
        }

    def resolve_name(self, requested="auto"):
        allowed = ("auto", "onnx_ppocrv5", "paddleocr", "tesseract", "mock")
        if requested not in allowed:
            raise SidecarError(
                "invalid_params",
                "engine must be auto, onnx_ppocrv5, paddleocr, tesseract, or mock",
            )
        availability = self.available()
        selected = requested
        if selected == "auto":
            # Prefer PP-OCRv5 / Paddle. If the ONNX model was not bundled into the
            # worker, fall back to Tesseract so capture still works — but surface
            # the fallback via lastWarm so the UI can warn.
            selected = next(
                (name for name in ("onnx_ppocrv5", "paddleocr") if availability[name]),
                None,
            )
            if selected is None:
                allow_raw = os.environ.get("GRIDIRON_OCR_ALLOW_TESSERACT", "1").strip().lower()
                allow_tesseract = allow_raw not in ("0", "false", "no", "off")
                # Default soft Tesseract fallback when preferred engines are missing
                # (common when the ONNX model was not copied next to the exe).
                # Set GRIDIRON_OCR_ALLOW_TESSERACT=0 to require PP-OCR / Paddle only.
                if allow_tesseract and availability["tesseract"]:
                    selected = "tesseract"
                else:
                    raise SidecarError(
                        "sidecar_unavailable",
                        "PP-OCRv5 (onnx) or PaddleOCR is required for HUD capture",
                        {
                            "install": [
                                "pip install onnxruntime",
                                "powershell -File ocr-sidecar/scripts/fetch-pp-ocrv5-onnx.ps1",
                                "ensure models/PP-OCRv5_mobile_rec/inference.onnx is next to the worker exe",
                                "GRIDIRON_OCR_ALLOW_TESSERACT=0 to disable soft Tesseract fallback",
                            ],
                            "available": availability,
                        },
                    )
        if not availability[selected]:
            raise SidecarError(
                "sidecar_unavailable",
                f"requested OCR engine is unavailable: {selected}",
                {"engine": selected},
            )
        return selected

    def create(self, requested="auto"):
        selected = self.resolve_name(requested)
        with self._lock:
            cached = self._cache.get(selected)
            if cached is not None:
                return cached
        engine = self._instantiate(selected)
        with self._lock:
            existing = self._cache.get(selected)
            if existing is not None:
                return existing
            self._cache[selected] = engine
            return engine

    def warm(self, requested="auto"):
        started = time.monotonic()
        selected = self.resolve_name(requested)
        with self._lock:
            already_cached = selected in self._cache
        engine = self.create(selected)
        # Tiny synthetic recognition forces provider/session paths to initialize once.
        try:
            import numpy as np

            probe = np.zeros((48, 160), dtype=np.uint8)
            engine.recognize(probe, {"psm": 7, "language": "eng", "whitelist": "", "mockText": "", "mockConfidence": 1})
        except Exception:
            # Warm is best-effort beyond construction; construction success is enough to cache.
            pass
        payload = {
            "engine": engine.name,
            "requested": requested,
            "cachedBefore": already_cached,
            "warmMs": round((time.monotonic() - started) * 1000),
            "preferred": engine.name in ("onnx_ppocrv5", "paddleocr"),
            "fallback": engine.name == "tesseract",
        }
        self._last_warm = payload
        return payload

    def _instantiate(self, selected):
        factories = {
            "mock": MockEngine,
            "onnx_ppocrv5": OnnxPaddleRecEngine,
            "paddleocr": PaddleEngine,
            "tesseract": TesseractEngine,
        }
        try:
            return factories[selected]()
        except SidecarError:
            raise
        except Exception as exc:
            raise SidecarError(
                "sidecar_unavailable",
                f"failed to initialize OCR engine: {selected}",
                {"engine": selected, "reason": str(exc)},
            ) from exc
