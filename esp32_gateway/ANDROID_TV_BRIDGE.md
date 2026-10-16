# Control de Android TV

Las órdenes de TV se envían por Android TV Remote desde el puente Python del PC. El ESP32 sigue atendiendo luces, pileta y portón; no intenta conectarse al puerto HTTP `8080` de las TVs.

## Requisitos de operación

- El PC debe estar encendido, con la sesión de Windows iniciada y conectado a la misma red local que las TVs.
- Las credenciales de Firebase del dispositivo se leen desde `include/config.local.h`; no se suben a Git.
- El emparejamiento Android TV se guarda en el perfil del usuario de Windows.
- El programador de tareas inicia el puente al iniciar sesión como `SmartPanel-AndroidTV-Bridge`.
- Para iniciarlo manualmente desde la raíz del proyecto: `python scripts/android_tv_firebase_bridge.py`.

El puente descarta comandos vencidos, ejecuta una orden nueva y escribe el resultado en `home/state/tvCommandResult`. La web espera ese resultado y muestra error si el PC o la TV no están disponibles. El resultado confirma que Android TV Remote aceptó el envío; no equivale a telemetría del estado físico de la pantalla.

## Emparejar de nuevo

Desde la raíz del proyecto, ejecutar `python legacy_backup/pair_android_tv.py <IP>` y completar el código en pantalla. Las IP se encuentran en `esp32_gateway/include/config.local.h`.
