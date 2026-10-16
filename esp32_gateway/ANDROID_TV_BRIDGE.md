# Control Autónomo de Android TV (CERO PC)

Las órdenes de TV ahora las ejecuta directamente el **ESP32-S3 por Wi-Fi local** utilizando el protocolo Android TV Remote v2 (TLS con mTLS en el puerto 6466). No se requiere PC encendida, scripts de Python ni tareas programadas en Windows.

## Arquitectura de Operación

1. **Lectura en tiempo real**: El ESP32 escucha el stream en `/home/commands/tv` mediante la biblioteca Firebase ESP Client en Core 1.
2. **Despacho asíncrono**: Core 1 encola la orden a `workerTask` en Core 0 para no bloquear la comunicación de red.
3. **Comunicación Wi-Fi mTLS**: El ESP32 abre un socket `WiFiClientSecure` con la IP del televisor en el puerto 6466, autentica mediante el certificado y clave RSA del televisor (`tv_certs.local.h`) y envía el mensaje Protobuf correspondiente (encendido, volumen, silencio, navegación, apps).
4. **Respuesta en Firebase**: El ESP32 publica el resultado en `/home/state/tvCommandResult` con el timestamp de la orden, permitiendo que la interfaz web confirme el envío de inmediato.

## Actualizaciones Inalámbricas (ArduinoOTA)

El firmware incorpora soporte para ArduinoOTA protegido por contraseña:
- **Puerto OTA**: 3232
- **Hostname**: `smartpanel-esp32`
- **Flasheo por Wi-Fi**: `pio run -e esp32-s3-ota -t upload`
