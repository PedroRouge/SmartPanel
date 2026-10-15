---
tipo: workflow
capa: ci-cd
modulo: entrega
estado: configurado-pendiente-de-acceso-github
fecha: 2026-10-14
tags:
  - tipo/workflow
  - capa/ci-cd
  - proyecto/smart-panel
---
# CI/CD y calidad automatizada — Smart Panel

> [!summary] Flujo
> [Workflow de GitHub Actions](../.github/workflows/ci-cd.yml) ejecuta controles en cada push de rama y en cada pull request. Incluye pruebas en Chromium, reglas en Firebase Emulator, API Python, contratos y compilación PlatformIO. El deploy de producción ocurre únicamente en `main`, después de que todos esos jobs pasen.

## Tubería

1. **Frontend:** sintaxis JavaScript, referencias/IDs HTML, CSP y versión de UI. Playwright en Chromium valida login visible, pestañas, paneles y navegación por teclado.
2. **Firebase Realtime Database:** Firebase Emulator verifica acceso por claims/UID y validaciones de comandos, portón y eventos.
3. **API Python:** instala requisitos de `legacy_backup/` y ejecuta pruebas unitarias de eventos y pruebas HTTP de estado/autorización.
4. **ESP32-S3:** copia el header de ejemplo a `config.local.h` y compila con PlatformIO. Los valores ficticios sirven solo para compilar.
5. **Functions:** instalación reproducible desde su lockfile y auditoría de dependencias de producción.
6. **Deploy:** al hacer push a `main`, Vercel publica el artefacto web y Firebase CLI publica Functions. Ambos despliegues esperan que los checks esten verdes.

Si un job falla, GitHub marca el check como fallido y no ejecuta el deploy. Configura las notificaciones de Actions en tu cuenta para recibir los avisos.

## Configuración externa requerida

### Secretos de Vercel en GitHub

En **Settings → Secrets and variables → Actions**, guarda:

| Secreto | Valor |
|---|---|
| `VERCEL_TOKEN` | Token de CI de Vercel con acceso al proyecto |
| `VERCEL_ORG_ID` | ID del equipo/cuenta Vercel |
| `VERCEL_PROJECT_ID` | ID del proyecto `smart-panel` |
| `FIREBASE_TOKEN` | Token Firebase CI con permiso de despliegue de Functions |
| `FIREBASE_WEB_API_KEY` | Clave cliente inyectada durante el deploy web; restringir por API y dominios en Google Cloud |
| `FIREBASE_WEB_VAPID_KEY` | Clave pública de Web Push inyectada durante el deploy web |

El proyecto detectado es `smart-panel`, URL `https://smart-panel-beryl.vercel.app`, ID `prj_aDyrkIXgQurddGsDujGMU2kFhJuR`; el equipo es `lsipedrorouge-9064s-projects`, ID `team_kZnLzpH0d7ATQ7RWoDf4CjEb`.

Genera el token limitado al proyecto desde una sesión Vercel con: `vercel tokens create "Smart Panel GitHub Actions" --project prj_aDyrkIXgQurddGsDujGMU2kFhJuR --json`. Guarda su valor únicamente como el secreto `VERCEL_TOKEN`.

La configuración Firebase de navegador y Service Worker se genera desde esos dos secretos mediante `scripts/generate-firebase-runtime-config.cjs`. El fallback versionado no contiene las claves. La API key web y la VAPID son datos públicos del cliente, no contraseñas; mantenlos restringidos en Google Cloud y nunca pongas claves administrativas, contraseñas o tokens en el frontend.

Los dos jobs de deploy requieren además la variable de repositorio `DEPLOYMENTS_ENABLED=true`. Déjala sin configurar hasta que Vercel y Firebase tengan sus credenciales CI válidas; así los checks de calidad pueden ejecutarse sin publicar solo una parte de la aplicación.

### Proteger la rama de producción

En **Settings → Branches**, protege `main`, exige pull request y marca los checks requeridos:

- `Frontend, Firebase y contratos`
- `API Python`
- `Compilar firmware ESP32-S3`

El deploy se ejecuta al integrar cambios en `main`. Las ramas y pull requests solo construyen y prueban. Para `FIREBASE_TOKEN`, inicia Firebase CLI con `firebase login:ci` y guarda el token directamente como secreto GitHub; no lo confirmes en el repositorio ni lo compartas por chat. Habilita facturación en el proyecto si Cloud Functions la requiere.

### Actualizaciones

[Dependabot](../.github/dependabot.yml) revisa semanalmente las dependencias npm de raíz y Functions, además de las acciones GitHub.

## Ejecución local

```bash
npm ci
npm run test:ui
npm run test:rules
node --test tests/js/*.test.js
python -m pip install -r legacy_backup/requirements.txt
python -m unittest discover -s legacy_backup/tests -v
npm ci --prefix functions
npm audit --prefix functions --omit=dev --audit-level=high
cp esp32_gateway/include/config.example.h esp32_gateway/include/config.local.h
pio run -d esp32_gateway -e esp32-s3-devkitc-1
```

Se necesita Java 21 para Firebase Emulator. En PowerShell reemplaza `cp` por `Copy-Item`. El header de credenciales local está ignorado por Git.

## Límites conocidos

- La prueba de navegador corta solicitudes externas; cubre la interfaz, no autentica contra Firebase real ni prueba televisores.
- Firebase Emulator valida reglas localmente; no modifica producción.
- La compilación verifica código y enlace del firmware, pero no simula señales eléctricas ni el relé.
- La auditoría de npm reportó avisos en el toolchain de desarrollo; las dependencias de producción de Functions sí se auditan como puerta CI. Dependabot propone actualizaciones para revisar.
- Cloud Functions ya tienen job de deploy condicionado a `main`; requiere el secreto `FIREBASE_TOKEN`. Las reglas RTDB no se publican automaticamente para evitar un bloqueo antes de asignar claims de owner.

## Nodos relacionados

- [[Proyecto PlatformIO ESP32]]
- [[Configuración Vercel]]
- [[Funciones Cloud de notificaciones]]
- [[Update - 2026-10-14 - Remediación auditoría técnica]]
- [Workflow de GitHub Actions](../.github/workflows/ci-cd.yml)

#tipo/workflow #capa/ci-cd #proyecto/smart-panel
