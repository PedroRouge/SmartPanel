import argparse
from getpass import getpass
import sys

from servidor import load_user_records, normalize_username, save_user_records, set_user_credentials


def set_credentials(username_argument, password_argument=None, from_stdin=False):
    username = username_argument or input("Usuario: ").strip()
    try:
        username = normalize_username(username)
    except ValueError as error:
        print("Error: {}".format(error), file=sys.stderr)
        return 2

    if password_argument is not None:
        password = password_argument
    elif from_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass("Nueva contraseña (8-128 caracteres): ")
        confirmation = getpass("Repite la contraseña: ")
        if password != confirmation:
            print("Error: las contraseñas no coinciden.", file=sys.stderr)
            return 2

    if len(password) < 8 or len(password) > 128:
        print("Error: la contraseña debe tener entre 8 y 128 caracteres.", file=sys.stderr)
        return 2

    try:
        existing = username in load_user_records()
        set_user_credentials(username, password)
    except (OSError, RuntimeError, ValueError) as error:
        print("Error: {}".format(error), file=sys.stderr)
        return 2
    print("Usuario '{}' {} con éxito en el almacén privado.".format(username, "actualizado" if existing else "creado"))
    return 0


def remove_user(username_argument):
    try:
        username = normalize_username(username_argument)
        users = load_user_records()
    except (RuntimeError, ValueError) as error:
        print("Error: {}".format(error), file=sys.stderr)
        return 2
    if username not in users:
        print("No existe el usuario '{}'.".format(username), file=sys.stderr)
        return 2
    if len(users) < 2:
        print("No se puede borrar la última cuenta; establece otra primero.", file=sys.stderr)
        return 2
    del users[username]
    save_user_records(users)
    print("Usuario '{}' eliminado.".format(username))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Administra las cuentas de Smart Panel.")
    subparsers = parser.add_subparsers(dest="action", required=True)

    set_parser = subparsers.add_parser("set", help="Crear o cambiar usuario y contraseña")
    set_parser.add_argument("username", nargs="?", help="Nombre de usuario (opcional; si se omite, se solicita interactivamente)")
    set_parser.add_argument("--password", "-p", help="Contraseña (opcional; si se omite, se solicita de forma segura)")
    set_parser.add_argument("--stdin", action="store_true", help="Leer la contraseña desde la entrada estándar")

    remove_parser = subparsers.add_parser("remove", help="Eliminar una cuenta conservando al menos una")
    remove_parser.add_argument("username", help="Nombre de usuario a eliminar")

    subparsers.add_parser("list", help="Listar nombres de usuario")

    args = parser.parse_args()

    if args.action == "set":
        return set_credentials(args.username, args.password, args.stdin)
    if args.action == "remove":
        return remove_user(args.username)
    try:
        usernames = sorted(load_user_records())
    except RuntimeError as error:
        print("Error: {}".format(error), file=sys.stderr)
        return 2
    if usernames:
        for username in usernames:
            print(username)
    else:
        print("No hay cuentas configuradas. Ejecuta: python manage_users.py set")
    return 0


if __name__ == "__main__":
    sys.exit(main())