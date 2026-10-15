# Migración y seguridad de Smart Panel

Esta guía acompaña las reglas por roles y la configuración local del firmware.

## Acciones inmediatas

Las versiones anteriores del repositorio contenían una contraseña de Wi-Fi y una contraseña de Firebase para el ESP32. Trátalas como expuestas, aunque los archivos actuales ya no incluyan esos valores:

1. Cambia la contraseña Wi-Fi desde el router y actualiza los dispositivos legítimos que la usan.
2. En Firebase Authentication, cambia o elimina la contraseña del usuario del ESP32 y crea una contraseña única nueva.
3. Si el repositorio fue público o se compartió, considera expuestos también los valores del historial Git. Revocar una contraseña no elimina el historial.

No pegues contraseñas, tokens ni una clave privada de cuenta de servicio en el chat ni en el repositorio.

## Preparar Firebase

1. Confirma que existen en Firebase Authentication la cuenta propietaria y la cuenta dedicada al ESP32. Email/Password debe estar habilitado.
2. Configura credenciales de Firebase Admin SDK en una ubicación privada fuera del repositorio mediante Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`). La clave de Admin SDK nunca va en la PWA, el firmware ni Git.
3. Desde la carpeta `functions`, instala dependencias y asigna los claims personalizados. Usa el correo real de cada cuenta:

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\ruta-privada\firebase-admin.json'
   node scripts/set-role.js 'correo-propietario' admin
   node scripts/set-role.js 'correo-esp32' device
   ```

   `set-role.js` preserva otros claims y solo permite `admin`, `device` o `none`. Tras cambiar un rol, el usuario debe cerrar sesión y volver a iniciarla para recibir el claim actualizado.

4. Desde la raíz, selecciona el proyecto correcto en Firebase CLI y publica reglas y funciones:

   ```powershell
   firebase use <alias-del-proyecto>
   firebase deploy --only database,functions
   ```

   Las reglas nuevas niegan por defecto el acceso a `/home` salvo las rutas asignadas a `admin` y `device`. La agenda y los tokens push siguen aislados por UID. No publiques estas reglas antes de asignar el claim `admin` a la cuenta que usa la web: quedará autenticada, pero sin acceso al panel.
5. Confirma el dominio de Vercel en Firebase Authentication → Settings → Authorized domains.

La Function `scheduleEventReminders` crea tareas indexadas al guardar eventos. `calendarPush` despacha vencimientos y reintenta fallos con una espera temporal. Las tareas vencidas/cambiadas se verifican contra el evento actual antes de notificar.

## Preparar el firmware ESP32

1. Copia `esp32_gateway/include/config.example.h` como `esp32_gateway/include/config.local.h`.
2. Introduce localmente la nueva contraseña Wi-Fi y las credenciales rotadas del usuario con claim `device`.
3. `config.local.h` está ignorado por Git. No lo añadas al repositorio ni compartas binarios de firmware sin considerar que incluyen credenciales.
4. Compila y carga desde PlatformIO. El firmware ahora falla la compilación si falta el archivo local; también rechaza comandos físicos si NTP no sincronizó una hora confiable.
5. El portón informa `pulse_sent` o `pulse_failed`; no informa abierto/cerrado. Añade un sensor de posición antes de mostrar esos estados físicos.

## Modelo inicial de datos

`firebase_initial_data.json` ya no crea PINs débiles en `/home/auth` ni representa el portón como cerrado sin sensor. Si la base existente aún contiene esos campos, elimínalos manualmente desde Realtime Database. El estado del portón se considera desconocido hasta contar con sensores.

## Configuración web

La configuración Web Firebase en `html/js/firebase-config.js` contiene identificadores públicos de cliente. La API key web no sustituye reglas de Database ni debe considerarse autorización. La autorización se aplica con Firebase Auth y el claim personalizado `role=admin`.

## Operación

- Verifica cada cambio de reglas en Firebase Emulator Suite o en un proyecto de prueba antes de producción.
   - Prueba con cuatro casos: anónimo, usuario autenticado sin rol, `admin` y `device`. El usuario común no debe poder leer estado doméstico ni escribir comandos; el administrador puede emitir comandos; el dispositivo puede actualizar estado y consumir/limpiar únicamente las órdenes permitidas.
- No uses credenciales del usuario propietario en el firmware. El ESP32 debe conservar su usuario dedicado.
## Audit update 2026-10-15

- The ESP32 Firebase password was rotated; the replacement is stored only in the ignored `esp32_gateway/include/config.local.h`. Rebuild and flash firmware with this local configuration before connecting the device.
- Previous Wi-Fi credentials remain in public Git history and must be changed in the router. Do not commit the replacement; update only the ignored local configuration after the router change.
- The private LAN IP map now lives only in the ignored local configuration. `config.example.h` contains generic example addresses.
- Firebase rules now grant the device writes only to explicit state paths and validate event, push-token, and gateway-status data.
- The ESP32 still sends unauthenticated HTTP commands to local equipment; confirm each equipment endpoint is isolated to the trusted LAN before connecting the gateway.
