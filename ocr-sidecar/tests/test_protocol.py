import io
import json
import unittest

from ocr_sidecar.errors import SidecarError
from ocr_sidecar.server import JsonLinesServer, validate_request


class FakeService:
    shutdown_requested = False

    def execute(self, command, params, request_id=None):
        if command == "hello":
            return {"echoId": request_id, "params": params}
        if command == "shutdown":
            self.shutdown_requested = True
            return {"shuttingDown": True}
        raise SidecarError("unknown_command", "no such command")

    def shutdown(self, _params):
        self.shutdown_requested = True
        return {"shuttingDown": True}


class ProtocolTests(unittest.TestCase):
    def test_json_lines_success_and_schema_version(self):
        input_stream = io.BytesIO(
            b'{"id":"one","command":"hello","params":{}}\n'
            b'{"id":"two","command":"shutdown"}\n'
        )
        output = io.StringIO()
        JsonLinesServer(FakeService(), input_stream, output).serve_forever()
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual("1.0", lines[0]["schemaVersion"])
        self.assertTrue(lines[0]["ok"])
        self.assertEqual("one", lines[0]["result"]["echoId"])
        self.assertTrue(lines[1]["result"]["shuttingDown"])

    def test_invalid_json_returns_structured_error(self):
        input_stream = io.BytesIO(b"{not-json}\n")
        output = io.StringIO()
        JsonLinesServer(FakeService(), input_stream, output).serve_forever()
        response = json.loads(output.getvalue().splitlines()[0])
        self.assertFalse(response["ok"])
        self.assertEqual("invalid_json", response["error"]["code"])

    def test_rejects_deep_or_invalid_requests(self):
        with self.assertRaisesRegex(SidecarError, "id"):
            validate_request({"command": "hello"})
        value = []
        for _ in range(17):
            value = [value]
        with self.assertRaisesRegex(SidecarError, "depth"):
            validate_request({"id": 1, "command": "hello", "params": value})


if __name__ == "__main__":
    unittest.main()
