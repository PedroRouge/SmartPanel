"""Descubre Android TV compatibles con Android TV Remote dentro de la LAN.

Herramienta de aprovisionamiento: solo se usa una vez para emparejar cada
televisor y exportar sus certificados al firmware del ESP32. El panel en
producción no depende de este código ni de ninguna PC encendida.
"""

from __future__ import annotations

import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor

ANDROID_TV_PORT = 6466
SCAN_TIMEOUT = 0.6
SCAN_WORKERS = 64


def local_network() -> ipaddress.IPv4Network:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 80))
        local_ip = probe.getsockname()[0]
    finally:
        probe.close()
    return ipaddress.ip_network(local_ip + "/24", strict=False)


def has_android_tv_remote(ip: str) -> bool:
    connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    connection.settimeout(SCAN_TIMEOUT)
    try:
        return connection.connect_ex((ip, ANDROID_TV_PORT)) == 0
    except OSError:
        return False
    finally:
        connection.close()


def scan_android_tvs(network: ipaddress.IPv4Network | None = None) -> list[str]:
    network = network or local_network()
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 80))
        local_ip = probe.getsockname()[0]
    except OSError:
        local_ip = ""
    finally:
        probe.close()

    candidates = [str(host) for host in network.hosts() if str(host) != local_ip]
    with ThreadPoolExecutor(max_workers=SCAN_WORKERS) as executor:
        found = list(executor.map(has_android_tv_remote, candidates))
    return [ip for ip, ok in zip(candidates, found) if ok]
