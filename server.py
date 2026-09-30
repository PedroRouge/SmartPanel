from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import IPv4Network, ip_network
from urllib.error import URLError
from urllib.parse import parse_qs, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import json
import os
import socket
import threading
import time
from uuid import NAMESPACE_URL, UUID, uuid5

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
API_VERSION = "2026.09.30.7"
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
        standby = getattr(status, "is_stand_by", None)
        volume = getattr(status, "volume_level", None)
        muted = getattr(status, "volume_muted", None)
        return {
            "ok": True,
            "online": True,
            "poweredOn": not standby if isinstance(standby, bool) else None,
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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        parsed = urlsplit(self.path)
        path_parts = [unquote(part) for part in parsed.path.strip("/").split("/")]
        if parsed.path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "version": API_VERSION,
                "port": API_PORT,
                "scan_cidr": TV_SCAN_CIDR or "auto /24",
                "cast_control": pychromecast is not None
            })
            return
        if parsed.path == "/api/tvs":
            self.send_json(200, scan_local_tvs())
            return
        if len(path_parts) == 4 and path_parts[0] == "api" and path_parts[1] == "tvs" and path_parts[3] == "status":
            device = next((item for item in scan_local_tvs() if item["id"] == path_parts[2]), None)
            if not device:
                self.send_json(404, {"error": "No se encontró esa TV en la red; actualiza la lista"})
                return
            if not device.get("supportsCast"):
                self.send_json(422, {"error": "La TV no tiene abierto el puerto Cast 8009"})
                return
            try:
                self.send_json(200, read_cast_status(device["ip"], device.get("deviceUuid")))
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

    def log_message(self, format_string, *args):
        print("{} - {}".format(self.address_string(), format_string % args))


def run(port=API_PORT):
    server = ThreadingHTTPServer(("0.0.0.0", port), SmartPanelHandler)
    print("Smart Panel API en 0.0.0.0:{}".format(port))
    print("Subred de escaneo: {}".format(TV_SCAN_CIDR or "automática (/24 del servidor)"))
    server.serve_forever()


if __name__ == "__main__":
    run()