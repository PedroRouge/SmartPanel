# Notificaciones gratuitas de Smart Panel

La app conserva Firebase Spark, Realtime Database y Firebase Cloud Messaging. El envío programado en segundo plano se ejecuta desde Google Apps Script cada cinco minutos; no usa Cloud Functions, Cloud Scheduler, Cloud Build ni un servidor pago. Las notificaciones locales siguen funcionando cuando la app está abierta.

## Activación inicial (una sola vez)

La automatización necesita una identidad de servidor para leer la agenda de todos los usuarios y enviar con FCM. No compartas ni subas su clave privada a GitHub.

1. En Google Cloud Console, abre el proyecto `smart-panel-53d7b` y crea una cuenta de servicio llamada `smart-panel-free-push`.
2. Asígnale únicamente estos roles del proyecto:
   - **Firebase Realtime Database Admin** (`roles/firebasedatabase.admin`), para leer agendas y tokens y guardar marcas de entrega.
   - **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`), para enviar mensajes FCM.
3. Habilita **Firebase Cloud Messaging API** si Google lo solicita. Esto no activa facturación; no habilites Blaze ni agregues una cuenta de pagos.
4. Crea una clave JSON para esa cuenta de servicio. Conserva el archivo fuera del repositorio y elimina la descarga local después de copiar los datos.
5. En [Apps Script](https://script.google.com/), crea un proyecto independiente. En **Configuración del proyecto**, activa **Mostrar el archivo de manifiesto `appsscript.json`**. Reemplaza `Code.gs` y el manifiesto con `scripts/free-push/Code.gs` y `scripts/free-push/appsscript.json` de este repositorio.
6. En Apps Script → **Configuración del proyecto → Propiedades del script**, crea:
   - `FIREBASE_SERVICE_ACCOUNT_EMAIL`: valor `client_email` del JSON.
   - `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`: valor completo `private_key` del JSON, conservando los saltos de línea `\n`.
7. Ejecuta manualmente `verifySmartPanelFreePushAccess` y concede los permisos de solicitudes HTTPS y activadores. La función valida el acceso a Realtime Database y a FCM; un HTTP 400 de FCM es esperado en el mensaje de prueba porque usa un token ficticio, y demuestra que el endpoint rechazó el formato/token, no el acceso.
8. Ejecuta `installSmartPanelFreePushTrigger` una vez. Acepta el permiso para crear activadores. Confirma en **Activadores** que `runSmartPanelFreePush` quedó programado cada cinco minutos.
9. En la web HTTPS, inicia sesión y pulsa **Activar avisos** en cada dispositivo. El navegador debe permitir notificaciones.

La cuenta de servicio y la clave son credenciales sensibles: dales acceso solo a este proyecto, no las pegues en chats ni las guardes en el repositorio. Si se filtra la clave, revócala en Google Cloud Console y crea otra.

## Qué envía

- Recorre los eventos de `/users/{uid}/events` y envía recordatorios 24 horas y 2 horas antes del horario del evento, en hora de Buenos Aires. Para eventos de día completo toma las 09:00.
- Guarda una marca idempotente en `/pushSent` después de un envío correcto y descarta tokens que FCM informa como vencidos.
- Lee `/home/pushAlerts`, envía esos avisos a los tokens registrados y elimina cada aviso entregado.
- Un bloqueo evita que dos ejecuciones del mismo proyecto procesen los avisos a la vez. El margen de recuperación de avisos de agenda es de diez minutos.

El archivo ejecutable está en `scripts/free-push/Code.gs`. Apps Script no forma parte del pipeline de GitHub Actions: su trigger se crea una sola vez desde tu cuenta Google. El pipeline solo publica reglas de RTDB y el sitio.

## Costos y límites

Esta configuración no pide habilitar facturación. Apps Script tiene cuotas diarias y puede retrasar ejecuciones; los avisos pueden llegar con hasta unos cinco minutos de demora. Las cuotas gratuitas de Firebase también tienen límites de almacenamiento y transferencia. Si una cuota se excede, el servicio puede limitarse hasta que se renueve el cupo; no habilites facturación para resolverlo.

Si todavía no configuraste Apps Script, los avisos locales se muestran únicamente mientras Smart Panel está abierto. El worker necesita que completes la activación inicial para enviar con la app cerrada.

## Compatibilidad

- Android y navegadores de escritorio compatibles: requieren HTTPS, permiso explícito y soporte para Push API/Service Worker.
- iPhone/iPad: el soporte de FCM web depende de la versión de iOS/iPadOS, de instalar la PWA en Inicio y de las limitaciones actuales de Firebase; el botón de la app informa si el navegador no es compatible.
- Los modos de ahorro de batería, concentración y permisos del sistema operativo pueden retrasar o impedir una notificación push.
