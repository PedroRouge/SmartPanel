# Notificaciones gratuitas de Smart Panel

La app conserva Firebase Spark, Realtime Database y Firebase Cloud Messaging. El envío programado en segundo plano se ejecuta desde Google Apps Script cada cinco minutos; no usa Cloud Functions, Cloud Scheduler, Cloud Build ni un servidor pago. Las notificaciones locales siguen funcionando cuando la app está abierta.

## Estado de esta instalación

- El worker está desplegado como API ejecutable de Apps Script y solo el propietario puede ejecutarlo.
- El activador `runSmartPanelFreePush` está instalado cada cinco minutos.
- Las propiedades `FIREBASE_SERVICE_ACCOUNT_EMAIL` y `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` están guardadas en las propiedades privadas del proyecto Apps Script. Ninguna clave privada está en Git.
- El proyecto estándar de Apps Script y el cliente OAuth local de `clasp` comparten `smart-panel-511720`. La cuenta de servicio `smart-panel-free-push` tiene acceso limitado al proyecto Firebase `smart-panel-53d7b` para RTDB y FCM.
- La validación leyó RTDB y autenticó con FCM usando un token ficticio. FCM respondió HTTP 400, como se esperaba; no se envió una notificación de prueba a ningún dispositivo.
- Firebase continúa en Spark y no hay servicios de facturación activados.

## Preparación inicial o recuperación

La automatización necesita una identidad de servidor para leer la agenda de todos los usuarios y enviar con FCM. No compartas ni subas su clave privada a GitHub.

1. En Google Cloud Console, abre el proyecto `smart-panel-53d7b` y reutiliza la cuenta de servicio `smart-panel-free-push`. Si la cuenta no existe, créala.
2. Asígnale únicamente estos roles del proyecto:
   - **Firebase Realtime Database Admin** (`roles/firebasedatabase.admin`), para leer agendas y tokens y guardar marcas de entrega.
   - **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`), para enviar mensajes FCM.
3. Habilita **Firebase Cloud Messaging API** si Google lo solicita. Esto no activa facturación; no habilites Blaze ni agregues una cuenta de pagos.
4. Crea una clave JSON para esa cuenta de servicio. Conserva el archivo fuera del repositorio y elimina la descarga local después de copiar los datos.
5. En [Apps Script](https://script.google.com/), crea un proyecto independiente y activa **Mostrar el archivo de manifiesto `appsscript.json`**. Vincúlalo a un proyecto estándar de Google Cloud que coincida con el cliente OAuth de `clasp`; activa Apps Script API allí. El manifiesto debe conservar `executionApi.access: "MYSELF"`. Reemplaza `Code.gs` y `appsscript.json` con los archivos de `scripts/free-push/`.
6. En Apps Script → **Configuración del proyecto → Propiedades del script**, crea:
   - `FIREBASE_SERVICE_ACCOUNT_EMAIL`: valor `client_email` del JSON.
   - `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY`: valor completo `private_key` del JSON, conservando los saltos de línea `\n`.
7. Despliega con `clasp` y concede los permisos de solicitudes HTTPS y activadores. Ejecuta `verifySmartPanelFreePushAccess`; HTTP 400 de FCM es esperado porque usa un token ficticio y no envía mensajes.
8. Ejecuta `installSmartPanelFreePushTrigger` una vez. Confirma en **Activadores** que `runSmartPanelFreePush` quedó programado cada cinco minutos.
9. En la web HTTPS, inicia sesión y pulsa **Activar avisos** en cada dispositivo. El navegador debe permitir notificaciones.

La cuenta de servicio y la clave son credenciales sensibles: dales acceso solo a este proyecto, no las pegues en chats ni las guardes en el repositorio. Si se filtra la clave, revócala en Google Cloud Console y crea otra.

## Qué envía

- Recorre los eventos de `/users/{uid}/events` y envía recordatorios 24 horas y 2 horas antes del horario del evento, en hora de Buenos Aires. Para eventos de día completo toma las 09:00.
- Guarda una marca idempotente en `/pushSent` después de un envío correcto y descarta tokens que FCM informa como vencidos.
- Lee `/home/pushAlerts`, envía esos avisos a los tokens registrados y elimina cada aviso entregado.
- Un bloqueo evita que dos ejecuciones del mismo proyecto procesen los avisos a la vez. El margen de recuperación de avisos de agenda es de diez minutos.

El archivo ejecutable está en `scripts/free-push/Code.gs`. Apps Script no forma parte del pipeline de GitHub Actions: el activador ya está instalado en la cuenta Google y se administra desde Apps Script. El pipeline solo publica reglas de RTDB y el sitio. Los archivos locales `.clasp.json` y `clasp-oauth.json` no se suben a Git.

## Costos y límites

Esta configuración no pide habilitar facturación. Apps Script tiene cuotas diarias y puede retrasar ejecuciones; los avisos pueden llegar con hasta unos cinco minutos de demora. Las cuotas gratuitas de Firebase también tienen límites de almacenamiento y transferencia. Si una cuota se excede, el servicio puede limitarse hasta que se renueve el cupo; no habilites facturación para resolverlo.

Si todavía no configuraste Apps Script, los avisos locales se muestran únicamente mientras Smart Panel está abierto. El worker necesita que completes la activación inicial para enviar con la app cerrada.

## Compatibilidad

- Android y navegadores de escritorio compatibles: requieren HTTPS, permiso explícito y soporte para Push API/Service Worker.
- iPhone/iPad: el soporte de FCM web depende de la versión de iOS/iPadOS, de instalar la PWA en Inicio y de las limitaciones actuales de Firebase; el botón de la app informa si el navegador no es compatible.
- Los modos de ahorro de batería, concentración y permisos del sistema operativo pueden retrasar o impedir una notificación push.
