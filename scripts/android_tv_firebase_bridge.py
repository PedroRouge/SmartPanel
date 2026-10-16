"""Route Firebase TV commands through the locally paired Android TV Remote clients."""

from __future__ import annotations

import json
import os
import re
import socket
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "legacy_backup"))

from android_tv_power import (  # noqa: E402
    launch_android_tv_app,
    power_control_ready,
    send_android_tv_key,
    set_android_tv_volume,
    toggle_android_tv_power,
)

LOCAL_CONFIG = ROOT / "esp32_gateway" / "include" / "config.local.h"
STATE_DIR = Path.home() / ".smart-panel" / "androidtvremote"
LAST_COMMAND_FILE = STATE_DIR / "last_firebase_command_timestamp"
COMMAND_MAX_AGE_MS = 60_000
FIREBASE_AUTH_TIMEOUT = 12
FIREBASE_HTTP_TIMEOUT = 20
LOG_FILE = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "SmartPanel" / "logs" / "android-tv-bridge.log"

TV_NAMES = {
    "tv-pedro": "Pedro",
    "tv-living": "Living",
    "tv-padres": "Padres",
    "tv-lucas": "Lucas",
}


def read_local_config() -> dict[str, str]:
    if not LOCAL_CONFIG.is_file():
        raise RuntimeError("No se encontró esp32_gateway/include/config.local.h")
    values = {}
    pattern = re.compile(r'^\s*#define\s+(FIREBASE_[A-Z_]+|TV_(?:PEDRO|LIVING|PADRES|LUCAS)_IP)\s+"([^"]*)"')
    for line in LOCAL_CONFIG.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if match:
            values[match.group(1)] = match.group(2)
    required = ("FIREBASE_API_KEY", "FIREBASE_DATABASE_URL", "FIREBASE_USER_EMAIL", "FIREBASE_USER_PASSWORD")
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise RuntimeError("Falta configuración local: " + ", ".join(missing))
    return values


class FirebaseRest:
    def __init__(self, config: dict[str, str]):
        self.config = config
        self.base = config["FIREBASE_DATABASE_URL"].rstrip("/")
        self.id_token = ""
        self.refresh_token = ""
        self.expires_at = 0.0

    def _json_request(self, url: str, payload: dict | None = None, timeout: int = FIREBASE_HTTP_TIMEOUT):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        request = Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
        with urlopen(request, timeout=timeout) as response:
            body = response.read()
        return json.loads(body.decode("utf-8")) if body else None

    def sign_in(self):
        url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?" + urlencode(
            {"key": self.config["FIREBASE_API_KEY"]}
        )
        response = self._json_request(url, {
            "email": self.config["FIREBASE_USER_EMAIL"],
            "password": self.config["FIREBASE_USER_PASSWORD"],
            "returnSecureToken": True,
        }, FIREBASE_AUTH_TIMEOUT)
        self.id_token = response["idToken"]
        self.refresh_token = response["refreshToken"]
        self.expires_at = time.time() + int(response.get("expiresIn", "3600")) - 60
        print("Firebase: sesión del dispositivo autenticada.", flush=True)

    def ensure_token(self):
        if not self.id_token or time.time() >= self.expires_at:
            self.sign_in()

    def _url(self, path: str):
        self.ensure_token()
        return self.base + path + ".json?" + urlencode({"auth": self.id_token})

    def read(self, path: str):
        return self._json_request(self._url(path))

    def write(self, path: str, value):
        request = Request(
            self._url(path),
            data=json.dumps(value).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        with urlopen(request, timeout=FIREBASE_HTTP_TIMEOUT) as response:
            response.read()

    def stream_url(self, path: str):
        return self._url(path)


def load_last_timestamp() -> int:
    try:
        return int(LAST_COMMAND_FILE.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        return 0


def save_last_timestamp(timestamp: int):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    temporary = LAST_COMMAND_FILE.with_suffix(".tmp")
    temporary.write_text(str(timestamp), encoding="ascii")
    temporary.replace(LAST_COMMAND_FILE)


def execute_command(firebase: FirebaseRest, command: dict):
    target_id = command.get("targetId")
    action = command.get("action")
    value = command.get("value")
    timestamp = command.get("timestamp")
    if target_id not in TV_NAMES or action not in ("power", "toggle_mute", "set_volume", "launch_app", "remote_key"):
        raise ValueError("La orden de TV tiene un destino o acción no admitidos")

    ip_key = {"tv-pedro": "TV_PEDRO_IP", "tv-living": "TV_LIVING_IP", "tv-padres": "TV_PADRES_IP", "tv-lucas": "TV_LUCAS_IP"}[target_id]
    host = read_local_config()[ip_key]
    if not power_control_ready(host):
        raise RuntimeError("Android TV sin emparejar")

    if action == "power":
        toggle_android_tv_power(host)
    elif action == "toggle_mute":
        send_android_tv_key(host, "MUTE")
    elif action == "set_volume":
        value = set_android_tv_volume(host, value)
    elif action == "launch_app":
        launch_android_tv_app(host, value)
    elif action == "remote_key":
        send_android_tv_key(host, value)

    result = {
        "timestamp": int(timestamp),
        "targetId": target_id,
        "action": action,
        "success": True,
    }
    firebase.write("/home/state/tvCommandResult", result)
    print(f"TV {TV_NAMES[target_id]}: {action} enviada por Android TV Remote.", flush=True)


def process_current_command(firebase: FirebaseRest, last_timestamp: int) -> int:
    command = firebase.read("/home/commands/tv")
    if not isinstance(command, dict):
        return last_timestamp
    try:
        timestamp = int(command.get("timestamp", 0))
    except (TypeError, ValueError):
        return last_timestamp
    if timestamp <= last_timestamp:
        return last_timestamp
    now_ms = int(time.time() * 1000)
    if timestamp <= 0 or now_ms - timestamp > COMMAND_MAX_AGE_MS:
        save_last_timestamp(timestamp)
        print("Firebase: descarté un comando TV vencido; no se repetirá.", flush=True)
        return max(last_timestamp, timestamp)

    save_last_timestamp(timestamp)
    try:
        execute_command(firebase, command)
    except Exception as error:
        result = {
            "timestamp": timestamp,
            "targetId": command.get("targetId", ""),
            "action": command.get("action", ""),
            "success": False,
            "message": str(error)[:200],
        }
        try:
            firebase.write("/home/state/tvCommandResult", result)
        except Exception as write_error:
            print("Firebase: no se pudo publicar el error de ejecución:", write_error, flush=True)
        print("Error procesando comando TV:", error, flush=True)
    return timestamp


def run():
    if sys.stdout is None or sys.stderr is None:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        log = LOG_FILE.open("a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = log
        if sys.stderr is None:
            sys.stderr = log
    firebase = FirebaseRest(read_local_config())
    last_timestamp = load_last_timestamp()
    print("Puente Android TV iniciado; no se reproducen órdenes antiguas.", flush=True)
    while True:
        try:
            firebase.ensure_token()
            request = Request(
                firebase.stream_url("/home/commands/tv"),
                headers={"Accept": "text/event-stream", "Cache-Control": "no-cache"},
            )
            print("Firebase: escuchando órdenes TV.", flush=True)
            with urlopen(request, timeout=300) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line.startswith("data:"):
                        last_timestamp = process_current_command(firebase, last_timestamp)
        except KeyboardInterrupt:
            print("Puente Android TV detenido.", flush=True)
            return
        except (HTTPError, URLError, TimeoutError, socket.timeout, OSError, ValueError) as error:
            print("Firebase: se reconectará el puente TV:", error, flush=True)
            firebase.id_token = ""
            time.sleep(5)


if __name__ == "__main__":
    run()
