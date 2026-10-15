---
tipo: update
modulo: sistema
estado: implementado-parcial
fecha: 2026-10-14
tags:
  - tipo/update
  - arquitectura/sistema
  - seguridad
  - proyecto/smart-panel
---
# Remediación de auditoría técnica — Smart Panel

> [!info] Alcance de esta iteración
> Se aplicaron cambios al repositorio y se hizo una segunda revisión estática. No se desplegaron reglas ni funciones, no se compiló el firmware y no se probaron actuadores reales. Por eso, los cambios locales no demuestran todavía el estado del entorno Firebase publicado.

## Cambios aplicados

- Se retiraron credenciales del código del ESP32 y se agregó `config.example.h`; las credenciales locales se cargan desde `config.local.h`, ignorado por Git.
- Se restringieron las reglas de Realtime Database por rol y se agregaron validaciones de campos/rangos. Se incorporó un script para asignar el claim `role` a usuarios con Firebase Admin.
- Se cambió la entrega de recordatorios a una cola indexada con lease, límite de concurrencia, reintento y verificación del evento actual.
- Se endurecieron cabeceras CSP, se retiró el JavaScript inline y se validan/cotan valores locales, cámaras y estado compartido.
- Se eliminó la afirmación de posición del portón sin sensor. El firmware informa el resultado del pulso del relé; la interfaz mantiene la posición como desconocida.
- Se movieron operaciones Firebase fuera del callback de stream del firmware, se valida el contrato de comandos y se evita repetir un pulso tras una reconexión/reinicio mediante recibos persistentes.
- Se ajustó la interfaz de TV para dejar claro que publicar una solicitud no confirma su ejecución física.
- Se agregaron el lockfile de Functions y la guía de rotación, asignación de roles y despliegue.

## Segunda auditoría estática

Se revisaron de nuevo permisos, secretos en archivos actuales, entradas de UI, estados físicos afirmados, notificaciones, flujo de comandos, CSP, configuración inicial y coherencia de versión. Se corrigieron dos inconsistencias encontradas en esta pasada: etiqueta HTML v69 y registro de órdenes de TV como exitosas antes de recibir confirmación.

Comprobaciones realizadas:

- `node --check` para los JavaScript modificados.
- Parseo JSON de reglas, datos iniciales, Vercel y manifiestos/lockfile de Functions.
- `git diff --check`.

Estas comprobaciones estáticas pasan. No equivalen a pruebas de reglas en Firebase, despliegue, build PlatformIO ni ensayo con ESP32.

## Pendientes necesarios antes de producción

1. Rotar la clave Wi-Fi y la contraseña Firebase que aparecieron en una versión anterior. El historial Git conserva esos valores; el cambio de archivos actuales no los revoca. La reescritura del historial y la coordinación con clones requieren una decisión operativa del propietario.
2. Crear/actualizar roles `owner` y `device`, renovar las sesiones web y desplegar reglas y Functions en el proyecto correcto. Confirmar primero la identidad del usuario propietario para evitar bloquear acceso.
3. Crear `config.local.h` con secretos rotados y preparar credenciales de servicio fuera del repositorio. El firmware no compila sin este archivo intencionalmente.
4. Validar reglas con Firebase Emulator o proyecto de staging; desplegar y comprobar cuentas owner, device y usuario sin rol.
5. Conectar ESP32, validar cada salida con carga segura y comprobar relé, respuestas LAN/IR y recuperación de conectividad.

## Deuda que queda abierta

- `html/js/app.js` sigue concentrando varios dominios; dividirlo en módulos es una refactorización grande que conviene hacer incrementalmente con cobertura de comportamiento.
- La librería Mobizt `Firebase ESP Client` usada por PlatformIO está deprecada upstream. Migrar a la biblioteca sucesora requiere revisar las API asíncronas y compilar/probar con el hardware.
- La cola de notificaciones y las reglas necesitan validación de integración en Firebase. La sintaxis JSON es válida, pero aún no se han ejecutado contra el motor de reglas.
- El recibo previo a ejecutar el relé evita duplicar una acción de toggle, pero si el ESP32 se reinicia entre guardar el recibo y activar el relé, la solicitud puede perderse. La UI deja el resultado físico como no confirmado; un protocolo con sensor/acuse explícito queda para la etapa de hardware.
- No se puede declarar la auditoría “sin fallos”: falta observar el sistema desplegado y el hardware real. La próxima iteración debería empezar con rotación de secretos y validación en staging.

## Referencias

- [[Auditoría técnica inicial]]
- [[Guía de migración y seguridad]]
- [[Reglas de Realtime Database]]
- [[Firmware principal main.cpp]]
- [[Funciones Cloud de notificaciones]]

#tipo/update #arquitectura/sistema #seguridad #proyecto/smart-panel
