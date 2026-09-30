from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import IPv4Network, ip_network
from urllib.error import URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
import json
import os
import socket
import time


API_PORT = int(os.environ.get("SMART_PANEL_API_PORT", "5000"))
TV_SCAN_CIDR = os.environ.get("TV_SCAN_CIDR", "").strip()
TV_SCAN_INTERVAL = 15
TV_SCAN_TIMEOUT = 0.2
TV_PORTS = (8008, 8009, 6466, 8001, 8002, 3000, 20060)
WEATHER_TIMEOUT = 10

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
    for port in TV_PORTS:
        connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        connection.settimeout(TV_SCAN_TIMEOUT)
        try:
            if connection.connect_ex((str(ip), port)) == 0:
                return {
                    "id": str(ip),
                    "name": "Android TV / Cast ({})".format(ip),
                    "room": "Dispositivo de red",
                    "model": "Puerto {}".format(port),
                    "ip": str(ip),
                    "online": True,
                    "poweredOn": None,
                    "state": "unknown",
                    "source": "tcp-scan"
                }
        except OSError:
            pass
        finally:
            connection.close()
    return None


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
    latitude = query.get("latitude", ["-34.6037"])[0]
    longitude = query.get("longitude", ["-58.3816"])[0]
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
        "daily": "weather_code,temperature_2m_max,temperature_2m_min",
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
        if parsed.path == "/api/tvs":
            self.send_json(200, scan_local_tvs())
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
        if parsed.path.startswith("/api/tvs/") and parsed.path.endswith("/command"):
            self.send_json(501, {
                "error": "Descubrimiento disponible; falta integrar el protocolo de control del fabricante"
            })
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