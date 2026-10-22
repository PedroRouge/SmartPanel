"""Exporta los certificados mTLS emparejados al header privado del firmware.

Uso: python scripts/export_tv_certs.py [--allow-missing]

El destino es siempre esp32_gateway/include/tv_certs.local.h (ignorado por Git)
y el proceso falla si falta algún par de certificados, para no generar un
archivo incompleto que el firmware interpretaría como una configuración válida.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = Path.home() / ".smart-panel" / "androidtvremote"
TARGET = ROOT / "esp32_gateway" / "include" / "tv_certs.local.h"

TVS = {
    "PEDRO": "192.168.0.10",
    "LIVING": "192.168.0.52",
    "PADRES": "192.168.0.53",
    "LUCAS": "192.168.0.51",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="genera el archivo aunque falte algún par de certificados",
    )
    args = parser.parse_args()

    missing: list[str] = []
    blocks: list[str] = [
        "#pragma once",
        "// Generado por scripts/export_tv_certs.py. No versionar: contiene claves privadas.",
        "",
    ]

    for name, ip in TVS.items():
        digest = hashlib.sha256(ip.encode("utf-8")).hexdigest()
        cert_file = STATE_DIR / f"{digest}.crt"
        key_file = STATE_DIR / f"{digest}.key"
        if not (cert_file.is_file() and key_file.is_file()):
            missing.append(f"{name} ({ip})")
            continue
        cert_text = cert_file.read_text(encoding="utf-8").strip()
        key_text = key_file.read_text(encoding="utf-8").strip()
        blocks.append(f'const char TV_{name}_CERT[] PROGMEM = R"rawcert(\n{cert_text}\n)rawcert";')
        blocks.append(f'const char TV_{name}_KEY[] PROGMEM = R"rawkey(\n{key_text}\n)rawkey";')
        blocks.append("")

    if missing and not args.allow_missing:
        raise SystemExit(
            "Faltan certificados emparejados para: "
            + ", ".join(missing)
            + ". Volvé a emparejar el Android TV Remote o usá --allow-missing a propósito."
        )

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text("\n".join(blocks), encoding="utf-8")
    try:
        os.chmod(TARGET, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    print(f"Generado {TARGET} ({TARGET.stat().st_size} bytes)")
    if missing:
        print("Certificados ausentes: " + ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
