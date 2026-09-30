import argparse
import asyncio
import os
import sys

from android_tv_power import create_remote, credential_paths
from servidor import scan_local_tvs


def select_tv(host):
    if host:
        return host
    devices = [device for device in scan_local_tvs() if 6466 in device.get("openPorts", [])]
    if not devices:
        raise RuntimeError("No se encontraron Android TV con el puerto 6466 abierto.")
    print("Android TV detectados:")
    for index, device in enumerate(devices, 1):
        print("{}. {} ({})".format(index, device["name"], device["ip"]))
    if len(devices) == 1:
        return devices[0]["ip"]
    selection = int(input("Selecciona el dispositivo: "))
    if selection < 1 or selection > len(devices):
        raise ValueError("Selección fuera de rango")
    return devices[selection - 1]["ip"]


async def pair(host):
    certificate, key = credential_paths(host)
    certificate.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(certificate.parent, 0o700)
    except OSError:
        pass
    remote = create_remote(host)
    try:
        await remote.async_generate_cert_if_missing()
        await remote.async_start_pairing()
        pairing_code = input("Ingresa el código de 6 caracteres mostrado en el ONN: ").strip()
        await remote.async_finish_pairing(pairing_code)
        try:
            os.chmod(key, 0o600)
        except OSError:
            pass
    finally:
        remote.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Empareja el Smart Panel con Android TV Remote.")
    parser.add_argument("host", nargs="?", help="IP del Android TV; si se omite, busca dispositivos en la LAN")
    args = parser.parse_args()
    try:
        host = select_tv(args.host)
        asyncio.run(pair(host))
    except (OSError, RuntimeError, ValueError) as error:
        print("Error: {}".format(error), file=sys.stderr)
        return 1
    print("Emparejamiento completado para {}.".format(host))
    return 0


if __name__ == "__main__":
    sys.exit(main())
