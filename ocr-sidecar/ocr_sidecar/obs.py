from .errors import SidecarError
from .shared_frame import (
    CAP_CONTROL_MAP_NAME,
    CAP_FRAME_MAP_NAME,
    SharedFrameConsumer,
)

CAPTURE_ADAPTERS = ("capture-bridge",)


def create_capture_bridge_consumer(backend=None):
    return SharedFrameConsumer(
        backend=backend,
        control_map_name=CAP_CONTROL_MAP_NAME,
        frame_map_name=CAP_FRAME_MAP_NAME,
        unavailable_code="capture_bridge_unavailable",
        unavailable_message="Capture Bridge shared-frame maps are unavailable",
        timeout_code="capture_bridge_frame_timeout",
        timeout_message="timed out waiting for a fresh Capture Bridge frame",
        adapter_name="capture-bridge",
    )


class ObsClient:
    """Reads Capture Bridge shared-frame maps. The class name is kept for existing sidecar calls."""

    def __init__(self, bridge_consumer=None):
        self._config = None
        self._bridge = bridge_consumer or create_capture_bridge_consumer()
        self._adapter = "capture-bridge"
        self._fresh_frame_timeout = 1.0
        self._last_capture_diagnostics = {}

    @property
    def configured(self):
        return self._config is not None

    def configure(self, params):
        if not isinstance(params, dict):
            raise SidecarError("invalid_params", "params must be an object")
        adapter = params.get("adapter", "capture-bridge")
        fresh_frame_timeout_ms = params.get("freshFrameTimeoutMs", 1000)
        if adapter not in CAPTURE_ADAPTERS:
            raise SidecarError("invalid_params", f"adapter must be one of: {', '.join(CAPTURE_ADAPTERS)}")
        if (isinstance(fresh_frame_timeout_ms, bool)
                or not isinstance(fresh_frame_timeout_ms, (int, float))
                or not 10 <= fresh_frame_timeout_ms <= 10000):
            raise SidecarError("invalid_params", "freshFrameTimeoutMs must be between 10 and 10000")
        self.close()
        self._config = {"adapter": adapter}
        self._adapter = adapter
        self._fresh_frame_timeout = float(fresh_frame_timeout_ms) / 1000
        return {"configured": True, "adapter": adapter}

    def capture_frame(self, source, adapter=None, timeout_seconds=None):
        selected = adapter or self._adapter
        if selected not in CAPTURE_ADAPTERS:
            raise SidecarError("invalid_params", f"unsupported capture adapter: {selected}")
        timeout = self._fresh_frame_timeout if timeout_seconds is None else timeout_seconds
        captured = self._bridge.capture(source, timeout_seconds=timeout)
        self._last_capture_diagnostics = captured.metadata()
        return captured

    def diagnostics(self):
        return dict(self._last_capture_diagnostics)

    def close(self):
        self._bridge.close()
