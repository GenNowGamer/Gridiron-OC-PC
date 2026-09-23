import threading

from .errors import SidecarError
from .images import decode_image_data
from .shared_frame import (
    CAP_CONTROL_MAP_NAME,
    CAP_FRAME_MAP_NAME,
    CapturedFrame,
    SharedFrameConsumer,
)

CAPTURE_ADAPTERS = ("websocket", "obs-plugin", "capture-bridge")


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
    """Small abstraction over obsws-python's OBS WebSocket v5 request client."""

    def __init__(self, client_factory=None, plugin_consumer=None, bridge_consumer=None):
        self._factory = client_factory
        self._client = None
        self._config = None
        self._lock = threading.Lock()
        self._plugin = plugin_consumer or SharedFrameConsumer()
        self._bridge = bridge_consumer or create_capture_bridge_consumer()
        self._adapter = "websocket"
        self._plugin_fallback = True
        self._fresh_frame_timeout = 1.0
        self._last_capture_diagnostics = {}
        self._obs_required = True

    @property
    def configured(self):
        return self._config is not None

    def configure(self, params):
        if not isinstance(params, dict):
            raise SidecarError("invalid_params", "params must be an object")
        host = params.get("host", "127.0.0.1")
        password = params.get("password", "")
        port = params.get("port", 4455)
        timeout = params.get("timeoutSeconds", 5)
        adapter = params.get("adapter", "websocket")
        plugin_fallback = params.get("pluginFallback", True)
        fresh_frame_timeout_ms = params.get("freshFrameTimeoutMs", 1000)
        if not isinstance(host, str) or not 1 <= len(host) <= 255:
            raise SidecarError("invalid_params", "host is invalid")
        if not isinstance(password, str) or len(password) > 1024:
            raise SidecarError("invalid_params", "password is invalid")
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise SidecarError("invalid_params", "port must be between 1 and 65535")
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 30:
            raise SidecarError("invalid_params", "timeoutSeconds must be between 1 and 30")
        if adapter not in CAPTURE_ADAPTERS:
            raise SidecarError("invalid_params", f"adapter must be one of: {', '.join(CAPTURE_ADAPTERS)}")
        if not isinstance(plugin_fallback, bool):
            raise SidecarError("invalid_params", "pluginFallback must be a boolean")
        if (isinstance(fresh_frame_timeout_ms, bool)
                or not isinstance(fresh_frame_timeout_ms, (int, float))
                or not 10 <= fresh_frame_timeout_ms <= 10000):
            raise SidecarError("invalid_params", "freshFrameTimeoutMs must be between 10 and 10000")
        self.close()
        self._config = {
            "host": host,
            "port": port,
            "password": password,
            "timeout": float(timeout),
        }
        self._adapter = adapter
        self._plugin_fallback = plugin_fallback
        self._fresh_frame_timeout = float(fresh_frame_timeout_ms) / 1000
        self._obs_required = adapter != "capture-bridge"
        if self._obs_required:
            self._connect()
        return {
            "configured": True,
            "host": host,
            "port": port,
            "adapter": adapter,
            "pluginFallback": plugin_fallback,
        }

    def _connect(self):
        if not self._config:
            raise SidecarError("obs_not_configured", "OBS connection is not configured")
        try:
            if self._factory is None:
                import obsws_python as obs
                factory = obs.ReqClient
            else:
                factory = self._factory
            self._client = factory(**self._config)
        except Exception as exc:
            self._client = None
            raise SidecarError(
                "obs_unavailable",
                "could not connect to OBS WebSocket v5",
                {"reason": str(exc), "host": self._config["host"], "port": self._config["port"]},
            ) from exc

    def _request(self, method, *args, **kwargs):
        if self._client is None:
            self._connect()
        try:
            with self._lock:
                return getattr(self._client, method)(*args, **kwargs)
        except Exception as exc:
            self.close()
            try:
                self._connect()
                with self._lock:
                    return getattr(self._client, method)(*args, **kwargs)
            except Exception as retry_exc:
                self.close()
                raise SidecarError(
                    "obs_request_failed",
                    f"OBS request failed after reconnect: {method}",
                    {"reason": str(retry_exc), "initialReason": str(exc)},
                ) from retry_exc

    def list_sources(self):
        inputs = self._request("get_input_list")
        scenes = self._request("get_scene_list")
        return {
            "inputs": list(getattr(inputs, "inputs", []) or []),
            "scenes": list(getattr(scenes, "scenes", []) or []),
        }

    def screenshot_data(self, source, width=0, height=0):
        if not isinstance(source, str) or not 1 <= len(source) <= 256:
            raise SidecarError("invalid_params", "source must be 1-256 characters")
        # obsws-python requires all five positional arguments even though the
        # OBS protocol treats width and height as optional. None is omitted by
        # the client's serializer and therefore requests native resolution.
        response = self._request(
            "get_source_screenshot",
            source,
            "png",
            width or None,
            height or None,
            -1,
        )
        data = getattr(response, "image_data", None)
        if not data:
            raise SidecarError("capture_failed", "OBS returned no screenshot data")
        return data

    def capture_frame(self, source, adapter=None, timeout_seconds=None):
        selected = adapter or self._adapter
        if selected not in CAPTURE_ADAPTERS:
            raise SidecarError("invalid_params", f"unsupported capture adapter: {selected}")
        timeout = self._fresh_frame_timeout if timeout_seconds is None else timeout_seconds
        if selected == "capture-bridge":
            captured = self._bridge.capture(source, timeout_seconds=timeout)
            self._last_capture_diagnostics = captured.metadata()
            return captured
        if selected == "obs-plugin":
            try:
                captured = self._plugin.capture(
                    source,
                    timeout_seconds=timeout,
                )
                self._last_capture_diagnostics = captured.metadata()
                return captured
            except SidecarError as exc:
                if not self._plugin_fallback:
                    raise
                captured = CapturedFrame(
                    image=decode_image_data(self.screenshot_data(source)),
                    adapter="websocket",
                    fallback_reason=exc.code,
                )
                self._last_capture_diagnostics = captured.metadata()
                return captured
        captured = CapturedFrame(
            image=decode_image_data(self.screenshot_data(source)),
            adapter="websocket",
        )
        self._last_capture_diagnostics = captured.metadata()
        return captured

    def diagnostics(self):
        return dict(self._last_capture_diagnostics)

    def close(self):
        self._plugin.close()
        self._bridge.close()
        client, self._client = self._client, None
        if client is not None:
            try:
                disconnect = getattr(client, "disconnect", None)
                if disconnect:
                    disconnect()
            except Exception:
                pass
