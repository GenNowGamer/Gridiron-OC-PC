import io
import json
import unittest

from ocr_sidecar.errors import SidecarError
from ocr_sidecar.obs import ObsClient
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


class FakeObsApi:
    def __init__(self, **config):
        self.config = config
        self.screenshot_args = None

    def get_input_list(self):
        return type("Response", (), {"inputs": [{"inputName": "Game Capture"}]})()

    def get_scene_list(self):
        return type("Response", (), {"scenes": [{"sceneName": "Madden"}]})()

    def get_source_screenshot(self, name, img_format, width, height, quality):
        self.screenshot_args = (name, img_format, width, height, quality)
        return type("Response", (), {"image_data": "data:image/png;base64,AA=="})()


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

    def test_obs_v5_dependency_abstraction(self):
        obs = ObsClient(client_factory=FakeObsApi)
        configured = obs.configure(
            {"host": "127.0.0.1", "port": 4455, "password": "secret", "timeoutSeconds": 2}
        )
        sources = obs.list_sources()
        self.assertTrue(configured["configured"])
        self.assertEqual("Game Capture", sources["inputs"][0]["inputName"])
        self.assertEqual("Madden", sources["scenes"][0]["sceneName"])
        self.assertNotIn("password", configured)

    def test_obs_request_reconnects_once(self):
        attempts = {"clients": 0}

        class ReconnectingApi(FakeObsApi):
            def __init__(self, **config):
                super().__init__(**config)
                attempts["clients"] += 1
                self.client_number = attempts["clients"]

            def get_input_list(self):
                if self.client_number == 1:
                    raise ConnectionError("disconnected")
                return super().get_input_list()

            def disconnect(self):
                pass

        obs = ObsClient(client_factory=ReconnectingApi)
        obs.configure({"host": "127.0.0.1", "port": 4455, "password": ""})
        sources = obs.list_sources()
        self.assertEqual(2, attempts["clients"])
        self.assertEqual("Game Capture", sources["inputs"][0]["inputName"])

    def test_obs_native_screenshot_supplies_required_sdk_arguments(self):
        obs = ObsClient(client_factory=FakeObsApi)
        obs.configure({"host": "127.0.0.1", "port": 4455, "password": ""})
        obs.screenshot_data("Game Capture")
        self.assertEqual(
            ("Game Capture", "png", None, None, -1),
            obs._client.screenshot_args,
        )


if __name__ == "__main__":
    unittest.main()
