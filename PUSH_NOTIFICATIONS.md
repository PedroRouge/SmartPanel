# Push notifications para Smart Panel

La PWA conserva un solo Service Worker (`html/service-worker.js`) para caché y FCM. El navegador despierta ese worker cuando llega un push: no queda ejecutándose de forma continua. La agenda local sigue mostrando avisos dentro de la app; el envío con la app cerrada lo realiza Firebase Functions, que consulta la agenda y manda el mensaje a FCM.

## Configuración

1. En Firebase Console, habilitá **Cloud Messaging** y generá una clave Web Push (VAPID) en Project settings → Cloud Messaging → Web configuration. Copiá la clave pública.
2. La clave pública VAPID compartida ya quedó configurada como `vapidKey` en `html/js/firebase-config.js`.
3. En Project settings → General → Your apps → Web app, confirmá que la configuración coincida con la que está en `firebase-config.js` y `service-worker.js`.
4. El dominio HTTPS `https://smart-panel-beryl.vercel.app` ya quedó configurado como `APP_URL` en `functions/index.js`.
5. Publicá las reglas de `firebase_rules.json` en Realtime Database. Las reglas agregan `/pushTokens/{uid}` para que cada usuario autenticado solo pueda escribir y leer sus propios tokens. Las funciones usan Admin SDK y no exponen credenciales servidoras en Vercel.
6. Desde la raíz, instalá Firebase CLI si hace falta, iniciá sesión, seleccioná el proyecto `smart-panel-53d7b` y desplegá:

   ```sh
   firebase use smart-panel-53d7b
   firebase deploy --only database,functions
   ```

   El SDK web tambien requiere que la API FCM Registration este habilitada en Google Cloud Console. En este proyecto, el despliegue de Cloud Functions quedo pendiente porque Firebase exige el plan Blaze para activar Cloud Build; por eso los avisos en segundo plano/con la web cerrada no se envian hasta desplegar esas funciones. La interfaz comprueba el permiso, registra el token y envia una notificacion nativa de prueba para validar cada dispositivo. FCM no requiere guardar una clave privada en el frontend.
7. Desplegá el frontend en Vercel. Abrí la web mediante HTTPS, iniciá sesión y tocá **Activar avisos**. El permiso se pide desde ese gesto; el token queda asociado a `pushTokens/{uid}`.
8. Para verificar la recepción, Firebase Console → Messaging → crear un mensaje de prueba y seleccionar el token FCM guardado. Probá con la PWA en segundo plano y cerrada.

## Mensajes de agenda y sistema

`functions/index.js` escanea `users/{uid}/events` cada cinco minutos. Envía una alerta el día anterior desde las 09:00 y el día del evento desde las 07:00, hora de Argentina, y registra cada envío en `/pushSent` para no repetirlo. Requiere que las fechas de agenda estén en `YYYY-MM-DD` y que cada evento tenga `title` y `date`.

Para disparar una alerta de sistema desde una Cloud Function o servidor confiable, escribí en Realtime Database:

```json
{
  "home": {
    "pushAlerts": {
      "alert-id": {
        "title": "Pileta",
        "body": "El ciclo programado terminó."
      }
    }
  }
}
```

El trigger `systemPush` la entrega a los dispositivos registrados y luego la elimina. No escribas este nodo desde un cliente público para eventos críticos; generá el aviso desde el backend que valida el origen del evento.

## Plataformas y límites

- Android y navegadores de escritorio compatibles: requiere HTTPS, permiso explícito y un navegador con Push API/Service Worker.
- iPhone/iPad: iOS/iPadOS 16.4 o posterior requiere que el usuario agregue el sitio a Inicio y abra esa web app instalada antes de aceptar el permiso. La tabla vigente de Firebase no marca FCM JavaScript como oficialmente compatible con iOS Safari; por eso el botón informa “Push no compatible” en esos entornos. Para cubrir iOS de forma soportada, se debe usar Web Push estándar con un emisor que implemente el protocolo de Apple, o una app nativa.
- Safari en macOS ofrece Web Push, pero la compatibilidad de FCM se debe comprobar en la versión concreta del navegador; la alternativa interoperable también es Web Push estándar.
- Los navegadores y el sistema operativo pueden limitar entregas por ahorro de batería, permisos, modo concentración o políticas del usuario. Un Service Worker no permanece corriendo continuamente.

Referencias oficiales: [configurar FCM web](https://firebase.google.com/docs/cloud-messaging/web/get-started), [recibir mensajes web](https://firebase.google.com/docs/cloud-messaging/web/receive-messages), [entornos soportados por Firebase JS](https://firebase.google.com/docs/web/environments-js-sdk), [Web Push de Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
