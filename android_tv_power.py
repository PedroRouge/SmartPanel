import asyncio
import hashlib
from pathlib import Path

try:
    from androidtvremote2 import AndroidTVRemote, CannotConnect, ConnectionClosed, InvalidAuth
except ImportError:
    AndroidTVRemote = None
    CannotConnect = ConnectionClosed = InvalidAuth = RuntimeError


REMOTE_CLIENT_NAME = "Smart Panel"


def credential_paths(host):
    identity = hashlib.sha256(host.encode("utf-8")).hexdigest()
    directory = Path.home() / ".smart-panel" / "androidtvremote"
    return directory / (identity + ".crt"), directory / (identity + ".key")


def power_control_ready(host):
    if AndroidTVRemote is None:
        return False
    certificate, key = credential_paths(host)
    return certificate.is_file() and key.is_file()


def create_remote(host):
    if AndroidTVRemote is None:
        raise RuntimeError("Falta instalar androidtvremote2: ejecuta pip3 install -r requirements.txt")
    certificate, key = credential_paths(host)
    return AndroidTVRemote(REMOTE_CLIENT_NAME, str(certificate), str(key), host, enable_ime=False)


async def _read_power_state(host):
    remote = create_remote(host)
    try:
        await remote.async_connect()
        return remote.is_on
    finally:
        remote.disconnect()


def read_android_tv_power_state(host):
    if not power_control_ready(host):
        return None
    try:
        return asyncio.run(_read_power_state(host))
    except (CannotConnect, ConnectionClosed, InvalidAuth, OSError, asyncio.TimeoutError):
        return None


async def _toggle_power(host):
    remote = create_remote(host)
    try:
        await remote.async_connect()
        previous_state = remote.is_on
        target_state = not previous_state if isinstance(previous_state, bool) else None
        remote.send_key_command("POWER")
        if target_state is not None:
            deadline = asyncio.get_running_loop().time() + 1.5
            while remote.is_on != target_state and asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(0.1)
        current_state = remote.is_on
        return current_state if current_state == target_state else target_state
    finally:
        remote.disconnect()


def toggle_android_tv_power(host):
    if not power_control_ready(host):
        raise RuntimeError("Android TV sin emparejar. Ejecuta python3 pair_android_tv.py en el servidor.")
    try:
        return asyncio.run(_toggle_power(host))
    except InvalidAuth as error:
        raise RuntimeError("El emparejamiento Android TV venció; vuelve a ejecutar pair_android_tv.py.") from error
