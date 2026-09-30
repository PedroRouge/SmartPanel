import asyncio
import hashlib
from pathlib import Path
import threading

try:
    from androidtvremote2 import AndroidTVRemote, CannotConnect, ConnectionClosed, InvalidAuth
except ImportError:
    AndroidTVRemote = None
    CannotConnect = ConnectionClosed = InvalidAuth = RuntimeError


REMOTE_CLIENT_NAME = "Smart Panel"
_pairing_sessions = {}
_pairing_lock = threading.Lock()


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


class _PairingSession:
    def __init__(self, host):
        self.host = host
        self.loop = None
        self.code_future = None
        self.started = threading.Event()
        self.finished = threading.Event()
        self.error = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self._pair())
        except BaseException as error:
            self.error = error
        finally:
            self.loop.close()
            self.finished.set()
            with _pairing_lock:
                if _pairing_sessions.get(self.host) is self:
                    del _pairing_sessions[self.host]

    async def _pair(self):
        certificate, key = credential_paths(self.host)
        certificate.parent.mkdir(parents=True, exist_ok=True)
        try:
            certificate.parent.chmod(0o700)
        except OSError:
            pass
        remote = create_remote(self.host)
        try:
            await remote.async_generate_cert_if_missing()
            try:
                key.chmod(0o600)
            except OSError:
                pass
            await remote.async_start_pairing()
            self.code_future = self.loop.create_future()
            self.started.set()
            pairing_code = await asyncio.wait_for(self.code_future, timeout=180)
            await remote.async_finish_pairing(pairing_code)
        finally:
            remote.disconnect()


def start_android_tv_pairing(host):
    if AndroidTVRemote is None:
        raise RuntimeError("Falta instalar androidtvremote2: ejecuta pip3 install -r requirements.txt")
    if power_control_ready(host):
        return {"paired": True}
    with _pairing_lock:
        session = _pairing_sessions.get(host)
        if session and not session.finished.is_set():
            return {"paired": False, "waitingForCode": session.started.is_set()}
        session = _PairingSession(host)
        _pairing_sessions[host] = session
        session.thread.start()
    if not session.started.wait(timeout=15):
        if session.finished.is_set() and session.error:
            raise RuntimeError("No se pudo iniciar el emparejamiento: {}".format(session.error))
        raise RuntimeError("El ONN no respondió al inicio del emparejamiento")
    return {"paired": False, "waitingForCode": True}


def finish_android_tv_pairing(host, pairing_code):
    code = pairing_code.strip().upper()
    if len(code) != 6 or any(character not in "0123456789ABCDEF" for character in code):
        raise ValueError("El código debe tener seis caracteres hexadecimales")
    with _pairing_lock:
        session = _pairing_sessions.get(host)
    if not session or not session.started.is_set() or not session.loop or not session.code_future:
        raise RuntimeError("Inicia primero el emparejamiento desde el botón de la TV")
    def submit_code():
        if not session.code_future.done():
            session.code_future.set_result(code)
    session.loop.call_soon_threadsafe(submit_code)
    if not session.finished.wait(timeout=15):
        raise RuntimeError("El ONN no confirmó el emparejamiento a tiempo")
    if session.error:
        raise RuntimeError("No se pudo emparejar: {}".format(session.error))
    certificate, key = credential_paths(host)
    try:
        key.chmod(0o600)
        certificate.parent.chmod(0o700)
    except OSError:
        pass
    return {"paired": True}


def cancel_android_tv_pairing(host):
    with _pairing_lock:
        session = _pairing_sessions.get(host)
    if not session or not session.started.is_set() or not session.loop or not session.code_future:
        return
    def cancel_pairing():
        if not session.code_future.done():
            session.code_future.set_result("CANCEL")
    session.loop.call_soon_threadsafe(cancel_pairing)
    session.finished.wait(timeout=2)


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
