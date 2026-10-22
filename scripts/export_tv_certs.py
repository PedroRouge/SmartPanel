"""Aprovisiona los certificados mTLS de los Android TV para el firmware del ESP32.

El ESP32 es el unico ejecutor de las ordenes de TV en produccion: no hay PC ni
servidor local en el camino. Para que eso sea posible, cada televisor necesita
en el firmware su certificado de cliente emparejado, el certificado autofirmado
del servidor (para fijarlo) y el nombre TLS (CN) de ese servidor.

Uso:
    python scripts/export_tv_certs.py [--allow-missing]

Lee las IPs de esp32_gateway/include/config.local.h, los certificados de cliente
del emparejamiento en ~/.smart-panel/androidtvremote y escribe
esp32_gateway/include/tv_certs.local.h (ignorado por Git). El certificado de
servidor se toma del televisor si responde y, si no, del cache local o del
header anterior, de modo que_volver a aprovisionar no pierde datos.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import socket
import ssl
import stat
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import serialization

ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = Path.home() / ".smart-panel" / "androidtvremote"
CONFIG_FILE = ROOT / "esp32_gateway" / "include" / "config.local.h"
TARGET = ROOT / "esp32_gateway" / "include" / "tv_certs.local.h"
ANDROID_TV_PORT = 6466
CONNECT_TIMEOUT = 6


def read_tv_ips() -> dict[str, str]:
    if not CONFIG_FILE.is_file():
        raise SystemExit(f"Falta {CONFIG_FILE}; no se puede resolver la red de los televisores.")
    pattern = re.compile(r'^\s*#define\s+TV_([A-Z]+)_IP\s+"([^"]+)"')
    ips = {}
    for line in CONFIG_FILE.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if match:
            ips[match.group(1)] = match.group(2)
    if not ips:
        raise SystemExit("No se encontraron definiciones TV_*_IP en config.local.h.")
    return ips


def read_previous_header() -> tuple[dict[str, str], dict[str, str]]:
    """Recupera los certificados de servidor y los nombres TLS del header anterior."""
    certs: dict[str, str] = {}
    hosts: dict[str, str] = {}
    if not TARGET.is_file():
        return certs, hosts
    text = TARGET.read_text(encoding="utf-8")
    for match in re.finditer(
        r"const char TV_([A-Z]+)_SERVER_CERT\[\] PROGMEM = R\"rawserver\(\n(.*?)\n\)rawserver\";",
        text,
        re.S,
    ):
        certs[match.group(1)] = match.group(2)
    for match in re.finditer(r"const char TV_([A-Z]+)_TLS_HOST\[\] PROGMEM = \"([^\"]*)\";", text):
        hosts[match.group(1)] = match.group(2)
    if CONFIG_FILE.is_file():
        config = CONFIG_FILE.read_text(encoding="utf-8")
        for match in re.finditer(
            r'"tv-([a-z]+)",\s*TV_([A-Z]+)_IP,\s*TV_[A-Z]+_CERT,\s*TV_[A-Z]+_KEY,\s*([^,]+),\s*([^,]+),',
            config,
        ):
            name = match.group(2)
            cert_expr = match.group(3).strip()
            host_expr = match.group(4).strip()
            if cert_expr.startswith("TV_") and name not in certs:
                certs.setdefault(name, "")
            if host_expr.startswith('"') and host_expr.endswith('"'):
                hosts.setdefault(name, host_expr.strip('"'))
    return certs, hosts


def fetch_server_certificate(ip: str, cert_file: Path, key_file: Path) -> tuple[str, str] | None:
    """Devuelve (certificado PEM del servidor, nombre TLS) si el televisor responde."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    try:
        context.load_cert_chain(certfile=str(cert_file), keyfile=str(key_file))
    except (OSError, ssl.SSLError) as error:
        print(f"{ip}: certificado de cliente invalido ({error})")
        return None
    try:
        with socket.create_connection((ip, ANDROID_TV_PORT), timeout=CONNECT_TIMEOUT) as raw:
            with context.wrap_socket(raw, server_hostname=ip) as tls:
                der = tls.getpeercert(binary_form=True)
    except (OSError, ssl.SSLError) as error:
        print(f"{ip}: el televisor no respondio ({error})")
        return None
    certificate = x509.load_der_x509_certificate(der)
    common_names = certificate.subject.get_attributes_for_oid(x509.oid.NameOID.COMMON_NAME)
    if not common_names:
        print(f"{ip}: el certificado del servidor no tiene CN")
        return None
    pem = certificate.public_bytes(serialization.Encoding.PEM).decode("ascii")
    return pem, common_names[0].value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="genera el header aunque a alguna TV le falte algun certificado",
    )
    args = parser.parse_args()

    previous_certs, previous_hosts = read_previous_header()
    missing: list[str] = []
    blocks: list[str] = [
        "#pragma once",
        "// Generado por scripts/export_tv_certs.py. No versionar: contiene claves privadas.",
        "",
    ]

    for name, ip in read_tv_ips().items():
        digest = hashlib.sha256(ip.encode("utf-8")).hexdigest()
        cert_file = STATE_DIR / f"{digest}.crt"
        key_file = STATE_DIR / f"{digest}.key"
        server_file = STATE_DIR / f"{digest}.server.crt"
        host_file = STATE_DIR / f"{digest}.tls_host"

        cert_text = cert_file.read_text(encoding="utf-8").strip() if cert_file.is_file() else ""
        key_text = key_file.read_text(encoding="utf-8").strip() if key_file.is_file() else ""
        if not cert_text or not key_text:
            missing.append(f"{name} ({ip}): sin certificado de cliente emparejado")

        server_pem = ""
        tls_host = ""
        if cert_text and key_text:
            fetched = fetch_server_certificate(ip, cert_file, key_file)
            if fetched:
                server_pem, tls_host = fetched
                server_file.write_text(server_pem, encoding="ascii")
                host_file.write_text(tls_host, encoding="ascii")
            else:
                if server_file.is_file() and host_file.is_file():
                    server_pem = server_file.read_text(encoding="ascii").strip()
                    tls_host = host_file.read_text(encoding="ascii").strip()
                server_pem = server_pem or previous_certs.get(name, "")
                tls_host = tls_host or previous_hosts.get(name, "")
                if server_pem and tls_host:
                    print(f"{ip}: se reutiliza el certificado de servidor guardado")
        if not server_pem or not tls_host:
            missing.append(f"{name} ({ip}): sin certificado de servidor")

        blocks.append(f'const char TV_{name}_CERT[] PROGMEM = R"rawcert(\n{cert_text}\n)rawcert";')
        blocks.append(f'const char TV_{name}_KEY[] PROGMEM = R"rawkey(\n{key_text}\n)rawkey";')
        blocks.append(f'const char TV_{name}_SERVER_CERT[] PROGMEM = R"rawserver(\n{server_pem}\n)rawserver";')
        blocks.append(f'const char TV_{name}_TLS_HOST[] PROGMEM = "{tls_host}";')
        blocks.append("")

    if missing and not args.allow_missing:
        raise SystemExit(
            "Faltan datos de emparejamiento para:\n  - "
            + "\n  - ".join(missing)
            + "\nEmpareja el Android TV o usá --allow-missing a proposito."
        )

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text("\n".join(blocks), encoding="utf-8")
    try:
        os.chmod(TARGET, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    print(f"Generado {TARGET} ({TARGET.stat().st_size} bytes)")
    if missing:
        print("Datos ausentes:\n  - " + "\n  - ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
