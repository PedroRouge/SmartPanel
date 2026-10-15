import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


TEMP_DATA = tempfile.TemporaryDirectory(prefix="smart-panel-api-tests-")
os.environ["SMART_PANEL_DATA_DIR"] = TEMP_DATA.name
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import servidor  # noqa: E402


class EventValidationTests(unittest.TestCase):
    def test_accepts_a_valid_timed_event(self):
        event = servidor.validate_event({
            "title": "Prueba CI",
            "date": "2026-10-14",
            "start_time": "09:30",
            "end_time": "10:00",
            "all_day": False,
            "notes": "Evento de integración",
        })
        self.assertEqual(event["start_time"], "09:30")
        self.assertEqual(event["title"], "Prueba CI")

    def test_rejects_invalid_date_time_and_title(self):
        cases = [
            {"title": "x", "date": "2026-02-30", "start_time": "09:00"},
            {"title": "x", "date": "2026-10-14", "start_time": "25:61"},
            {"title": "", "date": "2026-10-14", "start_time": "09:00"},
        ]
        for event in cases:
            with self.subTest(event=event), self.assertRaises(ValueError):
                servidor.validate_event(event)

    def test_rejects_end_time_before_start(self):
        with self.assertRaises(ValueError):
            servidor.validate_event({
                "title": "Orden invertido",
                "date": "2026-10-14",
                "start_time": "10:00",
                "end_time": "09:00",
            })


class ApiEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), servidor.SmartPanelHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:{}".format(cls.server.server_address[1])

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        TEMP_DATA.cleanup()

    def test_auth_status_endpoint_is_available_without_a_session(self):
        with urlopen(self.base_url + "/api/auth/status", timeout=3) as response:
            payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(response.status, 200)
            self.assertTrue(payload["required"])
            self.assertFalse(payload["authenticated"])
            self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    def test_unconfigured_origin_cannot_preflight_cross_origin_requests(self):
        request = Request(
            self.base_url + "/api/events",
            headers={"Origin": "https://attacker.example"},
            method="OPTIONS",
        )
        with self.assertRaises(HTTPError) as result:
            urlopen(request, timeout=3)
        self.assertEqual(result.exception.code, 403)

    def test_private_events_endpoint_rejects_anonymous_requests(self):
        request = Request(self.base_url + "/api/events")
        with self.assertRaises(HTTPError) as result:
            urlopen(request, timeout=3)
        self.assertEqual(result.exception.code, 401)

    def test_login_rate_limit_ignores_spoofed_proxy_ip_header(self):
        request = Request(
            self.base_url + "/api/auth/login",
            data=json.dumps({"username": "not-a-user", "password": "wrong-password"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.99"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as result:
            urlopen(request, timeout=3)
        self.assertEqual(result.exception.code, 401)
        self.assertIn("127.0.0.1", servidor._login_failures)
        self.assertNotIn("203.0.113.99", servidor._login_failures)


if __name__ == "__main__":
    unittest.main()
