from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import IPv4Network, ip_network
from urllib.error import URLError
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen
import base64
import hashlib
import hmac
import xml.etree.ElementTree as ET
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import threading
import time
from uuid import NAMESPACE_URL, UUID, uuid5
from android_tv_power import (
    cancel_android_tv_pairing,
    finish_android_tv_pairing,
    power_control_ready,
    read_android_tv_power_state,
    send_android_tv_key,
    start_android_tv_pairing,
    toggle_android_tv_power,
)

try:
    import pychromecast
    from pychromecast.const import CAST_TYPE_CHROMECAST
    from pychromecast.models import CastInfo, HostServiceInfo
except ImportError:
    pychromecast = None
    CAST_TYPE_CHROMECAST = None
    CastInfo = None
    HostServiceInfo = None


API_PORT = int(os.environ.get("SMART_PANEL_API_PORT", "5000"))
API_VERSION = "2026.09.30.12"
API_DATA_DIR = Path(os.environ.get("SMART_PANEL_DATA_DIR", str(Path.home() / ".smart-panel")))
API_USERS_FILE = Path(os.environ.get("SMART_PANEL_USERS_FILE", str(API_DATA_DIR / "users.json")))
LEGACY_API_PASSWORD_FILE = Path(os.environ.get("SMART_PANEL_API_PASSWORD_FILE", str(API_DATA_DIR / "api_password.txt")))
API_SIGNING_KEY_FILE = API_DATA_DIR / "session_signing_key"
API_SESSION_TTL = 12 * 60 * 60
EVENTS_DB_PATH = Path(os.environ.get("SMART_PANEL_EVENTS_DB", str(API_DATA_DIR / "events.sqlite3")))
TV_SCAN_CIDR = os.environ.get("TV_SCAN_CIDR", "").strip()
TV_SCAN_INTERVAL = 15
TV_SCAN_TIMEOUT = 0.2
TV_PORTS = (8008, 8009, 6466, 8001, 8002, 3000, 20060)
WEATHER_TIMEOUT = 10
DEVICE_INFO_TIMEOUT = 0.8
CAST_COMMAND_TIMEOUT = 6

CAST_APP_IDS = {
    "netflix": "CA5E8412",
    "youtube": "YouTube",
    "disney+": "9AA5F3F5",
    "spotify": "CC32E753"
}

_scan_cache = {"time": 0, "devices": []}
_scan_lock = threading.Lock()
_active_sessions = {}
_active_sessions_lock = threading.Lock()
_user_store_lock = threading.RLock()
_login_failures = {}
_login_failures_lock = threading.Lock()
LOGIN_FAILURE_WINDOW = 15 * 60
MAX_LOGIN_FAILURES = 6


def _load_or_create_secret(path, length):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        secret = path.read_text(encoding="utf-8").strip()
        if secret:
            return secret
    secret = secrets.token_urlsafe(length)
    path.write_text(secret + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return secret


API_SIGNING_KEY = _load_or_create_secret(API_SIGNING_KEY_FILE, 48).encode("utf-8")


def normalize_username(username):
    normalized = str(username or "").strip().lower()
    if len(normalized) < 3 or len(normalized) > 32 or not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", normalized):
        raise ValueError("El usuario debe tener 3-32 caracteres: letras, números, punto, guion o guion bajo")
    return normalized


def hash_password(password):
    if not isinstance(password, str) or len(password) < 14 or len(password) > 128:
        raise ValueError("La contraseña debe tener entre 14 y 128 caracteres")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
    return {
        "salt": base64.urlsafe_b64encode(salt).decode("ascii"),
        "hash": base64.urlsafe_b64encode(digest).decode("ascii"),
        "algorithm": "scrypt"
    }


def load_user_records():
    if not API_USERS_FILE.is_file():
        return {}
    try:
        data = json.loads(API_USERS_FILE.read_text(encoding="utf-8"))
        users = data.get("users", {}) if isinstance(data, dict) else None
        if not isinstance(users, dict):
            raise ValueError("users debe ser un objeto")
        return users
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError("No se pudo leer el almacén privado de usuarios: {}".format(error)) from error


def save_user_records(users):
    API_DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        API_DATA_DIR.chmod(0o700)
    except OSError:
        pass
    temporary_path = API_USERS_FILE.with_name(API_USERS_FILE.name + "." + secrets.token_hex(6) + ".tmp")
    try:
        temporary_path.write_text(json.dumps({"users": users}, separators=(",", ":")) + "\n", encoding="utf-8")
        try:
            temporary_path.chmod(0o600)
        except OSError:
            pass
        os.replace(str(temporary_path), str(API_USERS_FILE))
        try:
            API_USERS_FILE.chmod(0o600)
        except OSError:
            pass
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def set_user_credentials(username, password):
    normalized = normalize_username(username)
    record = hash_password(password)
    with _user_store_lock:
        save_user_records({normalized: record})
    with _active_sessions_lock:
        _active_sessions.clear()

    try:
        LEGACY_API_PASSWORD_FILE.unlink()
    except FileNotFoundError:
        pass
    return normalized


def verify_user_credentials(username, password):
    try:
        normalized = normalize_username(username)
    except ValueError:
        normalized = ""
    if not isinstance(password, str) or len(password) > 128:
        return False
    with _user_store_lock:
        record = load_user_records().get(normalized)
    if not isinstance(record, dict) or record.get("algorithm") != "scrypt":
        hashlib.scrypt(password.encode("utf-8"), salt=b"SmartPanelDummySalt", n=2 ** 14, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
        return False
    try:
        salt = base64.urlsafe_b64decode(record["salt"].encode("ascii"))
        expected = base64.urlsafe_b64decode(record["hash"].encode("ascii"))
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(actual, expected)
    except (KeyError, TypeError, ValueError):
        return False


def login_is_rate_limited(client_key):
    now = time.time()
    with _login_failures_lock:
        attempts = [timestamp for timestamp in _login_failures.get(client_key, []) if now - timestamp < LOGIN_FAILURE_WINDOW]
        _login_failures[client_key] = attempts
        return len(attempts) >= MAX_LOGIN_FAILURES


def record_login_failure(client_key):
    with _login_failures_lock:
        _login_failures.setdefault(client_key, []).append(time.time())


def clear_login_failures(client_key):
    with _login_failures_lock:
        _login_failures.pop(client_key, None)


def create_session_token():
    expires_at = str(int(time.time()) + API_SESSION_TTL)
    payload = expires_at + "." + secrets.token_urlsafe(18)
    signature = hmac.new(API_SIGNING_KEY, payload.encode("ascii"), hashlib.sha256).hexdigest()
    token = payload + "." + signature
    with _active_sessions_lock:
        now = int(time.time())
        for active_token, expiry in list(_active_sessions.items()):
            if expiry < now:
                del _active_sessions[active_token]
        _active_sessions[token] = int(expires_at)
    return token


def verify_session_token(token):
    try:
        expires_at, nonce, signature = token.split(".", 2)
        if int(expires_at) < int(time.time()):
            return False
        payload = expires_at + "." + nonce
        expected = hmac.new(API_SIGNING_KEY, payload.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return False
        with _active_sessions_lock:
            return _active_sessions.get(token) == int(expires_at)
    except (AttributeError, TypeError, ValueError):
        return False


def revoke_session_token(token):
    with _active_sessions_lock:
        _active_sessions.pop(token, None)


def initialize_events_db():
    EVENTS_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(EVENTS_DB_PATH, timeout=10)
    try:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                event_date TEXT NOT NULL,
                start_time TEXT,
                end_time TEXT,
                all_day INTEGER NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        connection.execute("CREATE INDEX IF NOT EXISTS events_date_idx ON events(event_date, start_time)")
        connection.commit()
    finally:
        connection.close()


def validate_event(data):
    if not isinstance(data, dict):
        raise ValueError("El evento debe ser un objeto JSON")
    title = str(data.get("title", "")).strip()
    if not title or len(title) > 120:
        raise ValueError("El título es obligatorio y admite hasta 120 caracteres")
    try:
        event_date = date.fromisoformat(str(data.get("date", ""))).isoformat()
    except ValueError:
        raise ValueError("La fecha debe usar el formato AAAA-MM-DD")
    all_day = data.get("all_day", False)
    if not isinstance(all_day, bool):
        raise ValueError("all_day debe ser booleano")
    start_time = None if all_day else str(data.get("start_time") or "").strip()
    end_time = None if all_day else str(data.get("end_time") or "").strip()
    if not all_day:
        if not start_time:
            raise ValueError("Indica una hora de inicio o marca Todo el día")
        try:
            datetime.strptime(start_time, "%H:%M")
            if end_time:
                datetime.strptime(end_time, "%H:%M")
        except ValueError:
            raise ValueError("Las horas deben usar el formato HH:MM")
        if end_time and end_time <= start_time:
            raise ValueError("La hora de fin debe ser posterior a la de inicio")
    notes = str(data.get("notes", "")).strip()
    if len(notes) > 2000:
        raise ValueError("La nota admite hasta 2000 caracteres")
    return {
        "title": title,
        "date": event_date,
        "start_time": start_time or None,
        "end_time": end_time or None,
        "all_day": all_day,
        "notes": notes
    }


def get_scan_network():
    if TV_SCAN_CIDR:
        return ip_network(TV_SCAN_CIDR, strict=False)

    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 80))
        local_ip = probe.getsockname()[0]
        return IPv4Network(local_ip + "/24", strict=False)
    finally:
        probe.close()


def check_tv_ip(ip):
    open_ports = []
    for port in TV_PORTS:
        connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        connection.settimeout(TV_SCAN_TIMEOUT)
        try:
            if connection.connect_ex((str(ip), port)) == 0:
                open_ports.append(port)
        except OSError:
            pass
        finally:
            connection.close()
    if not open_ports:
        return None

    device = read_tv_identity(ip, open_ports)
    device["id"] = str(ip)
    device["ip"] = str(ip)
    device["online"] = True
    device["poweredOn"] = None
    device["state"] = "unknown"
    device["source"] = "tcp-scan"
    device["openPorts"] = open_ports
    device["controlPort"] = 8009 if 8009 in open_ports else None
    device["supportsCast"] = device["controlPort"] is not None
    return device


def read_tv_identity(ip, open_ports):
    identity = {
        "name": "Android TV / Cast",
        "room": "Dispositivo de red",
        "model": "Smart TV",
        "manufacturer": None,
        "deviceUuid": None
    }
    if 8008 in open_ports:
        try:
            request = Request(
                "http://{}:8008/setup/eureka_info?options=detail".format(ip),
                headers={"User-Agent": "SmartPanel/1.0"}
            )
            with urlopen(request, timeout=DEVICE_INFO_TIMEOUT) as response:
                details = json.loads(response.read().decode("utf-8"))
            if details.get("name"):
                identity["name"] = details["name"]
            if details.get("model_name"):
                identity["model"] = details["model_name"]
            if details.get("manufacturer"):
                identity["manufacturer"] = details["manufacturer"]
            if details.get("ssdp_udn"):
                identity["deviceUuid"] = details["ssdp_udn"].replace("uuid:", "")
        except (URLError, OSError, ValueError, json.JSONDecodeError):
            pass

    for port in (8008, 8001):
        if port not in open_ports:
            continue
        try:
            request = Request(
                "http://{}:{}/ssdp/device-desc.xml".format(ip, port),
                headers={"User-Agent": "SmartPanel/1.0"}
            )
            with urlopen(request, timeout=DEVICE_INFO_TIMEOUT) as response:
                root = ET.fromstring(response.read())
            xml_values = {}
            for element in root.iter():
                local_name = element.tag.rsplit("}", 1)[-1]
                if element.text and local_name in ("friendlyName", "manufacturer", "modelName", "UDN"):
                    xml_values[local_name] = element.text.strip()
            if xml_values.get("friendlyName"):
                identity["name"] = xml_values["friendlyName"]
            if xml_values.get("modelName"):
                identity["model"] = xml_values["modelName"]
            if xml_values.get("manufacturer"):
                identity["manufacturer"] = xml_values["manufacturer"]
            if xml_values.get("UDN"):
                identity["deviceUuid"] = xml_values["UDN"].replace("uuid:", "")
            break
        except (URLError, OSError, ET.ParseError):
            pass

    if identity["name"] == "Android TV / Cast":
        identity["name"] = "Dispositivo Cast ({})".format(ip)
    if identity["manufacturer"]:
        identity["model"] = "{} · {}".format(identity["manufacturer"], identity["model"])
    return identity


def send_cast_command(ip, device_uuid, action, value):
    if pychromecast is None:
        raise RuntimeError("Falta instalar PyChromecast: ejecuta pip3 install -r requirements.txt")

    try:
        cast_uuid = UUID(str(device_uuid)) if device_uuid else uuid5(NAMESPACE_URL, "smart-panel-cast:" + ip)
    except ValueError:
        cast_uuid = uuid5(NAMESPACE_URL, "smart-panel-cast:" + ip)

    cast_info = CastInfo(
        {HostServiceInfo(ip, 8009)},
        cast_uuid,
        "Chromecast",
        ip,
        ip,
        8009,
        CAST_TYPE_CHROMECAST,
        "Google Cast"
    )
    cast = pychromecast.Chromecast(cast_info=cast_info, tries=1, timeout=CAST_COMMAND_TIMEOUT)
    try:
        cast.wait(timeout=CAST_COMMAND_TIMEOUT)
        if action == "set_volume":
            if isinstance(value, bool):
                raise ValueError("El volumen debe ser un número entre 0 y 100")
            volume = float(value)
            if not 0 <= volume <= 100:
                raise ValueError("El volumen debe estar entre 0 y 100")
            cast.set_volume(volume / 100.0, timeout=CAST_COMMAND_TIMEOUT)
            if volume > 0 and cast.status.volume_muted:
                cast.set_volume_muted(False, timeout=CAST_COMMAND_TIMEOUT)
            return {"ok": True, "action": action, "volume": round(volume), "muted": False if volume > 0 else bool(cast.status.volume_muted)}
        if action in ("volume_up", "volume_down"):
            current_volume = cast.status.volume_level
            if current_volume is None:
                raise RuntimeError("El televisor no informó su volumen actual")
            delta = 0.05 if action == "volume_up" else -0.05
            volume = max(0.0, min(1.0, current_volume + delta))
            cast.set_volume(volume, timeout=CAST_COMMAND_TIMEOUT)
            return {"ok": True, "action": action, "volume": round(volume * 100), "muted": cast.status.volume_muted}
        if action == "set_mute":
            if not isinstance(value, bool):
                raise ValueError("Mute requiere un valor booleano")
            cast.set_volume_muted(value, timeout=CAST_COMMAND_TIMEOUT)
            return {"ok": True, "action": action, "muted": value}
        if action == "toggle_mute":
            muted = not cast.status.volume_muted
            cast.set_volume_muted(muted, timeout=CAST_COMMAND_TIMEOUT)
            return {"ok": True, "action": action, "muted": muted}
        if action == "launch_app":
            app_name = str(value).strip()
            app_id = CAST_APP_IDS.get(app_name.lower())
            if not app_id:
                raise LookupError("{} no tiene un ID Cast configurado para este dispositivo".format(app_name))
            cast.start_app(app_id, force_launch=True, timeout=CAST_COMMAND_TIMEOUT)
            return {"ok": True, "action": action, "app": app_name}
        raise ValueError("Acción no admitida: {}".format(action))
    finally:
        cast.disconnect(timeout=1)


def read_cast_status(ip, device_uuid):
    if pychromecast is None:
        raise RuntimeError("Falta instalar PyChromecast: ejecuta pip3 install -r requirements.txt")

    try:
        cast_uuid = UUID(str(device_uuid)) if device_uuid else uuid5(NAMESPACE_URL, "smart-panel-cast:" + ip)
    except ValueError:
        cast_uuid = uuid5(NAMESPACE_URL, "smart-panel-cast:" + ip)

    cast_info = CastInfo(
        {HostServiceInfo(ip, 8009)},
        cast_uuid,
        "Chromecast",
        ip,
        ip,
        8009,
        CAST_TYPE_CHROMECAST,
        "Google Cast"
    )
    cast = pychromecast.Chromecast(cast_info=cast_info, tries=1, timeout=CAST_COMMAND_TIMEOUT)
    try:
        cast.wait(timeout=CAST_COMMAND_TIMEOUT)
        status = cast.status
        active_input = getattr(status, "is_active_input", None)
        standby = getattr(status, "is_stand_by", None)
        volume = getattr(status, "volume_level", None)
        muted = getattr(status, "volume_muted", None)
        if active_input is True or standby is False:
            powered_on = True
        elif active_input is False or standby is True:
            powered_on = False
        else:
            powered_on = None
        return {
            "ok": True,
            "online": True,
            "poweredOn": powered_on,
            "volume": round(volume * 100) if isinstance(volume, (int, float)) else None,
            "muted": muted if isinstance(muted, bool) else None
        }
    finally:
        cast.disconnect(timeout=1)


def scan_local_tvs():
    now = time.time()
    with _scan_lock:
        if now - _scan_cache["time"] < TV_SCAN_INTERVAL:
            return list(_scan_cache["devices"])

        try:
            network = get_scan_network()
        except (OSError, ValueError) as error:
            print("No se pudo determinar la subred de TVs: {}".format(error))
            return []

        local_ip = None
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.connect(("192.0.2.1", 80))
            local_ip = probe.getsockname()[0]
            probe.close()
        except OSError:
            pass

        addresses = [address for address in network.hosts() if str(address) != local_ip]
        devices = []
        with ThreadPoolExecutor(max_workers=64) as executor:
            for result in executor.map(check_tv_ip, addresses):
                if result:
                    devices.append(result)

        _scan_cache["time"] = now
        _scan_cache["devices"] = devices
        print("Escaneo TV {}: {} dispositivo(s)".format(network, len(devices)))
        return list(devices)


def fetch_weather(query):
    latitude = query.get("latitude", ["-31.86519"])[0]
    longitude = query.get("longitude", ["-60.57469"])[0]
    try:
        lat = float(latitude)
        lon = float(longitude)
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("coordenadas fuera de rango")
    except ValueError as error:
        raise ValueError("coordenadas inválidas: {}".format(error))

    params = urlencode({
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,weather_code",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "forecast_days": 7,
        "timezone": "auto"
    })
    request = Request(
        "https://api.open-meteo.com/v1/forecast?" + params,
        headers={"User-Agent": "SmartPanel/1.0"}
    )
    with urlopen(request, timeout=WEATHER_TIMEOUT) as response:
        return response.read()


class SmartPanelHandler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > 65536:
            raise ValueError("El cuerpo JSON está vacío o es demasiado grande")
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("JSON inválido") from error
        if not isinstance(payload, dict):
            raise ValueError("El cuerpo JSON debe ser un objeto")
        return payload

    def is_authenticated(self):
        authorization = self.headers.get("Authorization", "")
        scheme, separator, token = authorization.partition(" ")
        return separator == " " and scheme.lower() == "bearer" and verify_session_token(token)

    def require_authentication(self):
        if self.is_authenticated():
            return True
        self.send_json(401, {"error": "Inicia sesión para usar la API"})
        return False

    def login(self):
        client_key = self.headers.get("CF-Connecting-IP", self.client_address[0])
        if login_is_rate_limited(client_key):
            self.send_json(429, {"error": "Demasiados intentos. Espera 15 minutos."})
            return
        try:
            payload = self.read_json_body()
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        username = payload.get("username")
        password = payload.get("password")
        if not verify_user_credentials(username, password):
            record_login_failure(client_key)
            self.send_json(401, {"error": "Usuario o contraseña incorrectos"})
            return
        clear_login_failures(client_key)
        self.send_json(200, {"token": create_session_token(), "expires_in": API_SESSION_TTL})

    def list_events(self, query):
        try:
            start_date = date.fromisoformat(query.get("from", [date.today().isoformat()])[0]).isoformat()
            end_date = date.fromisoformat(query.get("to", [start_date])[0]).isoformat()
        except ValueError:
            self.send_json(400, {"error": "El rango debe usar fechas AAAA-MM-DD"})
            return
        if end_date < start_date:
            self.send_json(400, {"error": "La fecha final no puede ser anterior a la inicial"})
            return
        connection = sqlite3.connect(EVENTS_DB_PATH, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            rows = connection.execute(
                "SELECT id, title, event_date, start_time, end_time, all_day, notes FROM events WHERE event_date BETWEEN ? AND ? ORDER BY event_date, all_day DESC, start_time, id",
                (start_date, end_date)
            ).fetchall()
            self.send_json(200, [self.event_payload(row) for row in rows])
        finally:
            connection.close()

    @staticmethod
    def event_payload(row):
        return {
            "id": row["id"],
            "title": row["title"],
            "date": row["event_date"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "all_day": bool(row["all_day"]),
            "notes": row["notes"]
        }

    def create_event(self):
        try:
            event = validate_event(self.read_json_body())
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        now = datetime.now().isoformat(timespec="seconds")
        connection = sqlite3.connect(EVENTS_DB_PATH, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            cursor = connection.execute(
                "INSERT INTO events (title, event_date, start_time, end_time, all_day, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (event["title"], event["date"], event["start_time"], event["end_time"], int(event["all_day"]), event["notes"], now, now)
            )
            connection.commit()
            row = connection.execute("SELECT id, title, event_date, start_time, end_time, all_day, notes FROM events WHERE id = ?", (cursor.lastrowid,)).fetchone()
            self.send_json(201, self.event_payload(row))
        finally:
            connection.close()

    def update_event(self, event_id):
        try:
            event = validate_event(self.read_json_body())
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        connection = sqlite3.connect(EVENTS_DB_PATH, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            cursor = connection.execute(
                "UPDATE events SET title = ?, event_date = ?, start_time = ?, end_time = ?, all_day = ?, notes = ?, updated_at = ? WHERE id = ?",
                (event["title"], event["date"], event["start_time"], event["end_time"], int(event["all_day"]), event["notes"], datetime.now().isoformat(timespec="seconds"), event_id)
            )
            connection.commit()
            if not cursor.rowcount:
                self.send_json(404, {"error": "No se encontró el evento"})
                return
            row = connection.execute("SELECT id, title, event_date, start_time, end_time, all_day, notes FROM events WHERE id = ?", (event_id,)).fetchone()
            self.send_json(200, self.event_payload(row))
        finally:
            connection.close()

    def delete_event(self, event_id):
        connection = sqlite3.connect(EVENTS_DB_PATH, timeout=10)
        try:
            cursor = connection.execute("DELETE FROM events WHERE id = ?", (event_id,))
            connection.commit()
            if not cursor.rowcount:
                self.send_json(404, {"error": "No se encontró el evento"})
                return
            self.send_json(200, {"ok": True, "id": event_id})
        finally:
            connection.close()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        parsed = urlsplit(self.path)
        path_parts = [unquote(part) for part in parsed.path.strip("/").split("/")]
        if parsed.path == "/api/auth/status":
            self.send_json(200, {"required": True, "authenticated": self.is_authenticated(), "expires_in": API_SESSION_TTL})
            return
        if not self.require_authentication():
            return
        if parsed.path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "version": API_VERSION,
                "port": API_PORT,
                "scan_cidr": TV_SCAN_CIDR or "auto /24",
                "cast_control": pychromecast is not None,
                "auth_required": True
            })
            return
        if parsed.path == "/api/tvs":
            self.send_json(200, scan_local_tvs())
            return
        if parsed.path == "/api/events":
            self.list_events(parse_qs(parsed.query))
            return
        if len(path_parts) == 4 and path_parts[0] == "api" and path_parts[1] == "tvs" and path_parts[3] == "status":
            device = next((item for item in scan_local_tvs() if item["id"] == path_parts[2]), None)
            if not device:
                self.send_json(404, {"error": "No se encontró esa TV en la red; actualiza la lista"})
                return
            try:
                status = {"ok": True, "online": device.get("online", False), "poweredOn": None, "volume": None, "muted": None}
                if device.get("supportsCast"):
                    status.update(read_cast_status(device["ip"], device.get("deviceUuid")))
                android_tv_power = read_android_tv_power_state(device["ip"])
                if isinstance(android_tv_power, bool):
                    status["poweredOn"] = android_tv_power
                elif 6466 in device.get("openPorts", []):
                    status["poweredOn"] = True
                status["powerControlReady"] = power_control_ready(device["ip"])
                self.send_json(200, status)
            except RuntimeError as error:
                self.send_json(503, {"error": str(error)})
            except Exception as error:
                print("Error leyendo estado TV: {}".format(error))
                self.send_json(502, {"error": "No se pudo consultar el estado Cast", "detail": str(error)})
            return
        if parsed.path == "/api/weather":
            try:
                payload = fetch_weather(parse_qs(parsed.query))
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(payload)
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
            except (URLError, TimeoutError, OSError) as error:
                self.send_json(502, {"error": "No se pudo consultar Open-Meteo", "detail": str(error)})
            return
        self.send_json(404, {"error": "Ruta no encontrada"})

    def do_POST(self):
        parsed = urlsplit(self.path)
        path_parts = [unquote(part) for part in parsed.path.strip("/").split("/")]
        if parsed.path == "/api/auth/login":
            self.login()
            return
        if not self.require_authentication():
            return
        if parsed.path == "/api/events":
            self.create_event()
            return
        if parsed.path == "/api/auth/logout":
            authorization = self.headers.get("Authorization", "")
            _, _, token = authorization.partition(" ")
            revoke_session_token(token)
            self.send_json(200, {"ok": True})
            return
        if len(path_parts) == 5 and path_parts[:2] == ["api", "tvs"] and path_parts[3] == "pairing":
            device = next((item for item in scan_local_tvs() if item["id"] == path_parts[2]), None)
            if not device:
                self.send_json(404, {"error": "No se encontró esa TV en la red; actualiza la lista"})
                return
            try:
                if path_parts[4] == "start":
                    if 6466 not in device.get("openPorts", []):
                        self.send_json(422, {"error": "El dispositivo no ofrece Android TV Remote en el puerto 6466"})
                        return
                    self.send_json(200, start_android_tv_pairing(device["ip"]))
                elif path_parts[4] == "finish":
                    content_length = int(self.headers.get("Content-Length", "0"))
                    if content_length <= 0 or content_length > 65536:
                        self.send_json(400, {"error": "Falta el código de emparejamiento"})
                        return
                    pairing = json.loads(self.rfile.read(content_length).decode("utf-8"))
                    if not isinstance(pairing, dict):
                        self.send_json(400, {"error": "JSON inválido"})
                        return
                    result = finish_android_tv_pairing(device["ip"], str(pairing.get("code", "")))
                    result["powerControlReady"] = power_control_ready(device["ip"])
                    self.send_json(200, result)
                elif path_parts[4] == "cancel":
                    cancel_android_tv_pairing(device["ip"])
                    self.send_json(200, {"ok": True})
                else:
                    self.send_json(404, {"error": "Acción de emparejamiento no válida"})
            except json.JSONDecodeError:
                self.send_json(400, {"error": "JSON inválido"})
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
            except RuntimeError as error:
                self.send_json(503, {"error": str(error)})
            except Exception as error:
                print("Error emparejando Android TV: {}".format(error))
                self.send_json(502, {"error": "No se pudo emparejar Android TV", "detail": str(error)})
            return
        if len(path_parts) == 4 and path_parts[0] == "api" and path_parts[1] == "tvs" and path_parts[3] == "command":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0 or content_length > 65536:
                    self.send_json(400, {"error": "El cuerpo de la solicitud está vacío o es demasiado grande"})
                    return
                command = json.loads(self.rfile.read(content_length).decode("utf-8"))
                action = command.get("action")
                if not isinstance(action, str):
                    self.send_json(400, {"error": "Falta el campo action"})
                    return
                device = next((item for item in scan_local_tvs() if item["id"] == path_parts[2]), None)
                if not device:
                    self.send_json(404, {"error": "No se encontró esa TV en la red; actualiza la lista"})
                    return
                if action == "power":
                    self.send_json(200, {"ok": True, "action": action, "poweredOn": toggle_android_tv_power(device["ip"])})
                    return
                if action == "remote_key":
                    key = command.get("value")
                    send_android_tv_key(device["ip"], key)
                    self.send_json(200, {"ok": True, "action": action, "key": str(key).upper()})
                    return
                if not device.get("supportsCast"):
                    self.send_json(422, {"error": "La TV está detectada por los puertos {}, pero no tiene abierto el puerto Cast 8009".format(", ".join(str(port) for port in device.get("openPorts", [])))})
                    return
                result = send_cast_command(device["ip"], device.get("deviceUuid"), action, command.get("value"))
                self.send_json(200, result)
            except json.JSONDecodeError:
                self.send_json(400, {"error": "JSON inválido"})
            except LookupError as error:
                self.send_json(422, {"error": str(error)})
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
            except RuntimeError as error:
                self.send_json(503, {"error": str(error)})
            except Exception as error:
                print("Error enviando comando TV: {}".format(error))
                self.send_json(502, {"error": "No se pudo enviar el comando Cast", "detail": str(error)})
            return
        self.send_json(404, {"error": "Ruta no encontrada"})

    def do_PUT(self):
        if not self.require_authentication():
            return
        path_parts = [unquote(part) for part in urlsplit(self.path).path.strip("/").split("/")]
        if len(path_parts) == 3 and path_parts[:2] == ["api", "events"]:
            try:
                event_id = int(path_parts[2])
                if event_id <= 0:
                    raise ValueError
            except ValueError:
                self.send_json(400, {"error": "ID de evento inválido"})
                return
            self.update_event(event_id)
            return
        self.send_json(404, {"error": "Ruta no encontrada"})

    def do_DELETE(self):
        if not self.require_authentication():
            return
        path_parts = [unquote(part) for part in urlsplit(self.path).path.strip("/").split("/")]
        if len(path_parts) == 3 and path_parts[:2] == ["api", "events"]:
            try:
                event_id = int(path_parts[2])
                if event_id <= 0:
                    raise ValueError
            except ValueError:
                self.send_json(400, {"error": "ID de evento inválido"})
                return
            self.delete_event(event_id)
            return
        self.send_json(404, {"error": "Ruta no encontrada"})

    def log_message(self, format_string, *args):
        print("{} - {}".format(self.address_string(), format_string % args))


def run(port=API_PORT):
    users = load_user_records()
    if not users:
        raise RuntimeError("No hay usuarios configurados. Ejecuta 'python manage_users.py set' antes de iniciar la API.")
    initialize_events_db()
    server = ThreadingHTTPServer(("0.0.0.0", port), SmartPanelHandler)
    print("Smart Panel API en 0.0.0.0:{}".format(port))
    print("Subred de escaneo: {}".format(TV_SCAN_CIDR or "automática (/24 del servidor)"))
    print("Usuarios persistentes en {}".format(API_USERS_FILE))
    server.serve_forever()


if __name__ == "__main__":
    run()