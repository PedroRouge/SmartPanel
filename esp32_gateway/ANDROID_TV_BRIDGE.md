# Control Autónomo de Android TV (sin PC)

Las órdenes de TV las ejecuta directamente el **ESP32-S3 por Wi-Fi local** utilizando Android TV Remote v2 (TLS en el puerto 6466). No se requiere una PC encendida ni un proceso puente en Python. El cable USB solo es necesario para configurar o actualizar la placa; con el firmware instalado, puede alimentarse desde un cargador USB.

## Arquitectura de Operación

1. **Lectura en tiempo real**: El ESP32 escucha `/home/commands` mediante la biblioteca Firebase ESP Client en Core 1. Acepta tanto eventos directos de `/tv` como snapshots JSON de la ruta raíz `/` que Firebase puede emitir para actualizaciones multipath de la web.
2. **Despacho asíncrono**: Core 1 encola la orden a `workerTask` en Core 0 para no bloquear la comunicación de red.
3. **Comunicación Wi-Fi mTLS**: El ESP32 abre un socket `WiFiClientSecure` con la IP del televisor en el puerto 6466, valida el certificado autofirmado del servidor fijado para ese equipo y usa su nombre TLS (CN) mientras presenta el certificado y clave RSA emparejados del cliente (`tv_certs.local.h`). Completa la negociación Android TV Remote v2: responde a `remote_configure`, confirma `remote_set_active` y espera `remote_start` antes de transmitir una tecla, ajuste de volumen o apertura de app. El slider usa niveles directos de 0 a 25, los limita al máximo reportado por la TV y envía las teclas de volumen arriba/abajo necesarias desde el nivel actual; la conexión falla explícitamente si la TV no reporta ese nivel. No se envía `remote_set_volume_level` como comando, ya que ese mensaje es el reporte de estado de volumen de la TV al cliente. No usar `setInsecure()` aquí: en esta versión del core desactiva también la presentación del certificado cliente. Cada entrada de `SMART_TVS` requiere `serverCertPem` y `tlsHostname` correspondientes al televisor.
4. **Estado de energía**: Cada 30 segundos, y después de una orden de encendido, el ESP32 abre una sesión Android TV Remote de solo lectura y publica el campo `remote_start.started` en `/home/state/tvPower/{tvId}`. `true` se muestra como encendido y `false` como apagado. Si falta la configuración mTLS, la TV no responde o el dato supera 90 segundos, la interfaz muestra el estado como desconocido; una desconexión nunca se interpreta por sí sola como apagado. El sondeo y las órdenes comparten un bloqueo para no abrir sesiones mTLS simultáneas.
5. **Publicación y respuesta en Firebase**: La web publica cada orden con un `PUT` REST autenticado directamente a `/home/commands/tv`, separado de las actualizaciones multipath de metadatos. El ESP32 publica el resultado en `/home/state/tvCommandResult` con el timestamp de la orden. La web compara ese timestamp y no borra el resultado al esperar, para evitar perder una respuesta rápida. Las órdenes vencidas y los errores al verificar o reservar un recibo se publican como fallo en lugar de quedar esperando sin explicación.

El resultado exitoso indica que la TV inició la sesión remota y el ESP32 transmitió la solicitud; el protocolo no devuelve un acuse de que la tecla haya cambiado la imagen. No equivale a confirmar el estado físico de la pantalla. Para que `power` funcione en standby, el televisor debe mantener habilitado el control por red y estar accesible en la LAN. Una TV desconectada de Wi-Fi o sin energía no puede recibir esta orden.

## Actualizaciones Inalámbricas (ArduinoOTA)

El firmware incorpora soporte para ArduinoOTA protegido por contraseña:
- **Puerto OTA**: 3232
- **Hostname**: `smartpanel-esp32`
- **Flasheo por Wi-Fi**: `pio run -e esp32-s3-ota -t upload`
