import hashlib
from pathlib import Path

d = Path.home() / ".smart-panel" / "androidtvremote"
tvs = {
    "PEDRO": "192.168.0.10",
    "LIVING": "192.168.0.52",
    "PADRES": "192.168.0.53",
    "LUCAS": "192.168.0.51"
}

out = ["#pragma once", "// Certificados y claves mTLS emparejados para Android TV Remote v2", ""]
for name, ip in tvs.items():
    h = hashlib.sha256(ip.encode("utf-8")).hexdigest()
    crt_file = d / f"{h}.crt"
    key_file = d / f"{h}.key"
    if crt_file.exists() and key_file.exists():
        crt_txt = crt_file.read_text().strip()
        key_txt = key_file.read_text().strip()
        out.append(f"const char TV_{name}_CERT[] PROGMEM = R\"rawcert(\n{crt_txt}\n)rawcert\";")
        out.append(f"const char TV_{name}_KEY[] PROGMEM = R\"rawkey(\n{key_txt}\n)rawkey\";")
        out.append("")
    else:
        print(f"Missing for {name}")

target = Path("esp32_gateway/include/tv_certs.local.h")
target.write_text("\n".join(out), encoding="utf-8")
print(f"Generated {target} ({target.stat().st_size} bytes)")
