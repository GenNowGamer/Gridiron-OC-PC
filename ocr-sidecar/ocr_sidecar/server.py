import json
import sys
import threading

from . import SCHEMA_VERSION
from .errors import SidecarError
from .service import SidecarService

MAX_LINE_BYTES = 1024 * 1024
MAX_JSON_DEPTH = 16
MAX_ACTIVE_BURSTS = 2


def response_ok(request_id, result):
    return {"schemaVersion": SCHEMA_VERSION, "id": request_id, "ok": True, "result": result}


def response_error(request_id, error):
    body = {
        "schemaVersion": SCHEMA_VERSION,
        "id": request_id,
        "ok": False,
        "error": {"code": error.code, "message": error.message},
    }
    if error.details is not None:
        body["error"]["details"] = error.details
    return body


def validate_request(value):
    if not isinstance(value, dict):
        raise SidecarError("invalid_request", "request must be a JSON object")
    request_id = value.get("id")
    if not isinstance(request_id, (str, int)) or isinstance(request_id, bool):
        raise SidecarError("invalid_request", "id must be a string or integer")
    if isinstance(request_id, str) and not 1 <= len(request_id) <= 128:
        raise SidecarError("invalid_request", "string id must be 1-128 characters")
    command = value.get("command")
    if not isinstance(command, str) or not 1 <= len(command) <= 64:
        raise SidecarError("invalid_request", "command must be 1-64 characters")
    params = value.get("params", {})
    if _depth(params) > MAX_JSON_DEPTH:
        raise SidecarError("invalid_request", f"params exceeds maximum depth {MAX_JSON_DEPTH}")
    return request_id, command, params


def _depth(value):
    if isinstance(value, dict):
        return 1 + max((_depth(item) for item in value.values()), default=0)
    if isinstance(value, list):
        return 1 + max((_depth(item) for item in value), default=0)
    return 0


class JsonLinesServer:
    def __init__(self, service=None, input_stream=None, output_stream=None):
        self.service = service or SidecarService()
        self.input = input_stream or sys.stdin.buffer
        self.output = output_stream or sys.stdout
        self._write_lock = threading.Lock()
        self._workers = set()
        self._workers_lock = threading.Lock()

    def write(self, value):
        line = json.dumps(value, ensure_ascii=True, separators=(",", ":"))
        with self._write_lock:
            self.output.write(line + "\n")
            self.output.flush()

    def handle_value(self, value):
        request_id = value.get("id") if isinstance(value, dict) else None
        try:
            request_id, command, params = validate_request(value)
            result = self.service.execute(command, params, request_id)
            self.write(response_ok(request_id, result))
        except SidecarError as exc:
            self.write(response_error(request_id, exc))
        except Exception as exc:
            self.write(
                response_error(
                    request_id,
                    SidecarError("internal_error", "unexpected sidecar error", {"reason": str(exc)}),
                )
            )

    def _run_worker(self, value):
        try:
            self.handle_value(value)
        finally:
            with self._workers_lock:
                self._workers.discard(threading.current_thread())

    def serve_forever(self):
        while not self.service.shutdown_requested:
            raw = self.input.readline(MAX_LINE_BYTES + 2)
            if not raw:
                break
            if len(raw) > MAX_LINE_BYTES or not raw.endswith(b"\n"):
                self.write(response_error(None, SidecarError("input_too_large", "request line exceeds 1 MiB")))
                if not raw.endswith(b"\n"):
                    self.input.readline()
                continue
            try:
                value = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                self.write(response_error(None, SidecarError("invalid_json", "request is not valid UTF-8 JSON", {"reason": str(exc)})))
                continue
            if isinstance(value, dict) and value.get("command") == "capture.analyze_burst":
                with self._workers_lock:
                    if len(self._workers) >= MAX_ACTIVE_BURSTS:
                        request_id = value.get("id")
                        self.write(
                            response_error(
                                request_id,
                                SidecarError(
                                    "busy",
                                    f"at most {MAX_ACTIVE_BURSTS} capture bursts may run concurrently",
                                ),
                            )
                        )
                        continue
                    worker = threading.Thread(target=self._run_worker, args=(value,), daemon=True)
                    self._workers.add(worker)
                worker.start()
            else:
                self.handle_value(value)
        self.service.shutdown({})


def main():
    JsonLinesServer().serve_forever()


if __name__ == "__main__":
    main()
