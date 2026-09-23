import threading

from . import SCHEMA_VERSION, __version__
from .analysis import analyze_burst, analyze_frame, benchmark_capture
from .engines import EngineRegistry
from .errors import SidecarError
from .images import decode_image_data, decode_image_path, encode_png_data_url, estimate_anchor_drift
from .obs import ObsClient
from .profile import validate_profile

MAX_BURST_FRAMES = 30


class SidecarService:
    def __init__(self, obs=None, engines=None):
        self.obs = obs or ObsClient()
        self.engines = engines or EngineRegistry()
        self.cancel_events = {}
        self.cancel_lock = threading.Lock()
        self.shutdown_requested = False

    def execute(self, command, params, request_id=None):
        if not isinstance(params, dict):
            raise SidecarError("invalid_params", "params must be an object")
        handlers = {
            "hello": self.hello,
            "obs.configure": self.obs_configure,
            "obs.list_sources": self.obs_list_sources,
            "obs.preview": self.obs_preview,
            "engine.warm": self.engine_warm,
            "profile.test": self.profile_test,
            "capture.benchmark": self.capture_benchmark,
            "capture.analyze_burst": lambda p: self.capture_analyze_burst(p, request_id),
            "capture.cancel": self.capture_cancel,
            "shutdown": self.shutdown,
        }
        handler = handlers.get(command)
        if handler is None:
            raise SidecarError("unknown_command", f"unsupported command: {command}")
        return handler(params)

    def hello(self, _params):
        return {
            "name": "gridiron-ocr-sidecar",
            "version": __version__,
            "schemaVersion": SCHEMA_VERSION,
            "protocol": "json-lines",
            "commands": [
                "hello", "obs.configure", "obs.list_sources", "obs.preview",
                "engine.warm", "profile.test", "capture.benchmark", "capture.analyze_burst",
                "capture.cancel", "shutdown",
            ],
            "ocrEngines": self.engines.available(),
            "engineStatus": self.engines.status(),
            "captureAdapters": ["websocket", "obs-plugin", "capture-bridge"],
            "rawRetentionDefault": False,
        }

    def engine_warm(self, params):
        return self.engines.warm(params.get("engine", "auto"))

    def obs_configure(self, params):
        return self.obs.configure(params)

    def obs_list_sources(self, _params):
        return self.obs.list_sources()

    def obs_preview(self, params):
        source = _source(params)
        width = _bounded_int(params.get("width", 0), "width", 0, 3840)
        height = _bounded_int(params.get("height", 0), "height", 0, 1080)
        frame = decode_image_data(self.obs.screenshot_data(source, width, height))
        return {
            "source": source,
            "imageData": encode_png_data_url(frame),
            "width": int(frame.shape[1]),
            "height": int(frame.shape[0]),
            "format": "png",
            "retained": False,
        }

    def profile_test(self, params):
        profile = validate_profile(params.get("profile"))
        engine = self.engines.create(params.get("engine", "auto"))
        include_images = params.get("includeImages") is not False
        adapter = _adapter(params)
        timeout = _fresh_timeout(params)
        if "imagePath" in params and params.get("imagePath"):
            frame = decode_image_path(params["imagePath"])
        elif params.get("imageBase64"):
            frame = decode_image_data(params["imageBase64"])
        else:
            frame = self.obs.capture_frame(
                _source(params),
                adapter=adapter,
                timeout_seconds=timeout,
            )
            frame = getattr(frame, "image", frame)
        # Do not decode a full-frame reference for drift during interactive tests;
        # anchors alone are enough and keep the request small/fast.
        drift = estimate_anchor_drift(frame, profile.get("anchors") or [], None)
        return {
            "engine": engine.name,
            "profile": profile["name"],
            "rois": analyze_frame(frame, profile, engine, include_images=include_images, drift=drift),
            "anchorDrift": drift,
            "rawFrameRetained": False,
            "engineStatus": self.engines.status(),
        }

    def capture_benchmark(self, params):
        source = _source(params)
        frame_count = _bounded_int(params.get("frameCount", 3), "frameCount", 1, 5)
        interval_ms = _bounded_int(params.get("intervalMs", 80), "intervalMs", 0, 500)
        adapter = _adapter(params)
        timeout = _fresh_timeout(params)
        capture = lambda selected_source: self.obs.capture_frame(
            selected_source, adapter=adapter, timeout_seconds=timeout
        )
        result = benchmark_capture(capture, source, frame_count, interval_ms)
        result["requestedAdapter"] = adapter
        result["adapterDiagnostics"] = self.obs.diagnostics()
        return result

    def capture_analyze_burst(self, params, request_id):
        if request_id is None:
            raise SidecarError("invalid_request", "capture.analyze_burst requires an id")
        source = _source(params)
        profile = validate_profile(params.get("profile"))
        engine = self.engines.create(params.get("engine", "auto"))
        frame_count = _bounded_int(params.get("frameCount", 5), "frameCount", 1, MAX_BURST_FRAMES)
        interval_ms = _bounded_int(params.get("intervalMs", 100), "intervalMs", 0, 2000)
        adapter = _adapter(params)
        timeout = _fresh_timeout(params)
        capture = lambda selected_source: self.obs.capture_frame(
            selected_source, adapter=adapter, timeout_seconds=timeout
        )
        event = threading.Event()
        with self.cancel_lock:
            if request_id in self.cancel_events:
                raise SidecarError("duplicate_request", f"request is already active: {request_id}")
            self.cancel_events[request_id] = event
        try:
            result = analyze_burst(
                capture,
                source,
                profile,
                engine,
                frame_count,
                interval_ms,
                event,
                include_images=params.get("includeImages") is True,
            )
            result["profile"] = profile["name"]
            result["requestedAdapter"] = adapter
            result["adapterDiagnostics"] = self.obs.diagnostics()
            return result
        finally:
            with self.cancel_lock:
                self.cancel_events.pop(request_id, None)

    def capture_cancel(self, params):
        target = params.get("requestId")
        if not isinstance(target, (str, int)) or isinstance(target, bool):
            raise SidecarError("invalid_params", "requestId must be a string or integer")
        with self.cancel_lock:
            event = self.cancel_events.get(target)
            if event is not None:
                event.set()
        return {"requestId": target, "cancelRequested": event is not None}

    def shutdown(self, _params):
        self.shutdown_requested = True
        with self.cancel_lock:
            for event in self.cancel_events.values():
                event.set()
        self.obs.close()
        return {"shuttingDown": True}


def _source(params):
    source = params.get("source")
    if not isinstance(source, str) or not 1 <= len(source) <= 256:
        raise SidecarError("invalid_params", "source must be 1-256 characters")
    return source


def _bounded_int(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise SidecarError("invalid_params", f"{name} must be an integer between {low} and {high}")
    return value


def _adapter(params):
    adapter = params.get("adapter")
    if adapter is not None and adapter not in ("websocket", "obs-plugin", "capture-bridge"):
        raise SidecarError("invalid_params", "adapter must be websocket, obs-plugin, or capture-bridge")
    return adapter


def _fresh_timeout(params):
    value = params.get("freshFrameTimeoutMs")
    if value is None:
        return None
    return _bounded_int(value, "freshFrameTimeoutMs", 10, 10000) / 1000
