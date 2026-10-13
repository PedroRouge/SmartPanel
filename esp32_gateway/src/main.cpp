#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include <ir_Samsung.h>

#include "config.h"

// --- Objetos de Firebase ---
FirebaseData streamData;
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// --- Emisor Infrarrojo (Opcional por hardware) ---
IRsend irsend(IR_SEND_PIN);

// --- Variables de control ---
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 15000; // Cada 15 segundos
bool streamSubscribed = false;

// --- Prototipos de funciones ---
void initWiFi();
void initFirebase();
void sendHeartbeat();
bool executeHttpLocalCommand(const String& url);
void handleLightCommand(const String& lightName, bool targetState);
void handlePoolCommand(bool targetState);
void handleGateCommand(bool targetState);
void handleTvCommand(const String& targetId, const String& action, const String& value);
void streamCallback(FirebaseStream data);
void streamTimeoutCallback(bool timeout);

// =========================================================================
// SETUP
// =========================================================================
void setup() {
    Serial.begin(115200);
    delay(1500);

    Serial.println("\n==================================================");
    Serial.println("  SMART PANEL - GATEWAY IOT LOCAL (ESP32-S3)     ");
    Serial.println("==================================================");

    // Iniciar LED emisor Infrarrojo
    irsend.begin();

    // Conectar a la red Wi-Fi de la casa
    initWiFi();

    // Inicializar conexión con Firebase Realtime Database
    initFirebase();

    Serial.println("[Sistema] Gateway iniciado. Escuchando comandos en tiempo real...\n");
}

// =========================================================================
// LOOP
// =========================================================================
void loop() {
    // Mantener la conexión Wi-Fi activa
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[Wi-Fi] Conexión perdida, reintentando...");
        WiFi.reconnect();
        delay(3000);
        return;
    }

    // Heartbeat periódico a Firebase para informar que el ESP32 está online
    unsigned long now = millis();
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL || lastHeartbeat == 0) {
        lastHeartbeat = now;
        sendHeartbeat();
    }

    // La librería de Firebase maneja los eventos de Stream en segundo plano
    delay(20);
}

// =========================================================================
// CONEXIÓN WI-FI
// =========================================================================
void initWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false); // Mantener radio Wi-Fi despierto para mínima latencia
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.printf("[Wi-Fi] Conectando a %s", WIFI_SSID);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[Wi-Fi] Conectado exitosamente!");
        Serial.printf("[Wi-Fi] IP Local del ESP32-S3: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[Wi-Fi] Intensidad de señal (RSSI): %d dBm\n", WiFi.RSSI());
    } else {
        Serial.println("\n[Wi-Fi] Error: No se pudo conectar a la red Wi-Fi. Revisa credenciales.");
    }
}

// =========================================================================
// CONEXIÓN FIREBASE CON AUTENTICACIÓN SEGURA (Firebase Auth)
// =========================================================================
void initFirebase() {
    Serial.println("[Firebase] Inicializando cliente con autenticación segura...");

    config.api_key = FIREBASE_API_KEY;
    config.database_url = FIREBASE_DATABASE_URL;

    // Autenticación con cuenta de servicio / usuario del ESP32
    auth.user.email = FIREBASE_USER_EMAIL;
    auth.user.password = FIREBASE_USER_PASSWORD;

    // Callback opcional de estado del token
    config.token_status_callback = tokenStatusCallback;

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    // Ajustar tamaños de buffer HTTP
    streamData.setBSSLBufferSize(4096, 1024);
    fbdo.setBSSLBufferSize(4096, 1024);

    Serial.println("[Firebase] Esperando validación del token de autenticación...");
    unsigned long startAuth = millis();
    while (!Firebase.ready() && millis() - startAuth < 10000) {
        delay(200);
        Serial.print(".");
    }

    if (Firebase.ready()) {
        Serial.println("\n[Firebase Auth] Token JWT validado correctamente!");
    } else {
        Serial.println("\n[Firebase Auth] Advertencia: Token aún no validado, reintentando en segundo plano...");
    }

    // Iniciar el Stream continuo en tiempo real en "/home/commands"
    if (!Firebase.RTDB.beginStream(&streamData, "/home/commands")) {
        Serial.printf("[Firebase Stream Error] %s\n", streamData.errorReason().c_str());
        streamSubscribed = false;
    } else {
        Firebase.RTDB.setStreamCallback(&streamData, streamCallback, streamTimeoutCallback);
        streamSubscribed = true;
        Serial.println("[Firebase] Stream suscrito exitosamente a /home/commands");
    }
}

// =========================================================================
// HEARTBEAT (Informa a la web en Vercel que el ESP32 está activo)
// =========================================================================
void sendHeartbeat() {
    FirebaseJson json;
    json.set("online", true);
    json.set("ip", WiFi.localIP().toString());
    json.set("rssi", WiFi.RSSI());
    json.set("uptime", (unsigned long)(millis() / 1000));
    json.set("last_seen", (unsigned long)time(nullptr) > 100000 ? (unsigned long)time(nullptr) * 1000ULL : (unsigned long)millis());
    json.set("version", "1.0.0-esp32s3");

    if (Firebase.RTDB.setJSON(&fbdo, "/home/gateway/status", &json)) {
        // Heartbeat enviado correctamente
    } else {
        Serial.printf("[Heartbeat Error] %s\n", fbdo.errorReason().c_str());
    }
}

// =========================================================================
// CALLBACK DE STREAM FIREBASE (EVENTOS EN TIEMPO REAL)
// =========================================================================
void streamCallback(FirebaseStream data) {
    String path = data.dataPath();
    String dataType = data.dataType();

    Serial.printf("\n[Stream Event] Path: %s | Tipo: %s\n", path.c_str(), dataType.c_str());

    // 1. Control de Luces individuales: "/lights/living", "/lights/kitchen", etc.
    if (path.startsWith("/lights/")) {
        String lightName = path.substring(8); // Extraer el identificador
        if (dataType == "boolean") {
            bool targetState = data.boolData();
            handleLightCommand(lightName, targetState);
        }
    }
    // 2. Control de todas las Luces recibidas en bloque JSON: "/lights"
    else if (path == "/lights" && dataType == "json") {
        FirebaseJson json = data.jsonObject();
        size_t len = json.iteratorBegin();
        String key, value;
        int type = 0;
        for (size_t i = 0; i < len; i++) {
            json.iteratorGet(i, type, key, value);
            if (type == FirebaseJson::JSON_BOOL) {
                handleLightCommand(key, value == "true");
            }
        }
        json.iteratorEnd();
    }
    // 3. Control de Pileta: "/poolOn"
    else if (path == "/poolOn") {
        if (dataType == "boolean") {
            handlePoolCommand(data.boolData());
        }
    }
    // 4. Control de Portón: "/gateTrigger" o "/gateOpen"
    else if (path == "/gateTrigger" || path == "/gateOpen") {
        if (dataType == "boolean") {
            handleGateCommand(data.boolData());
        } else if (dataType == "int" || dataType == "double") {
            handleGateCommand(true); // Disparo por timestamp de gatillo
        }
    }
    // 5. Control de TV / Multimedia: "/tv"
    else if (path == "/tv" && dataType == "json") {
        FirebaseJson json = data.jsonObject();
        FirebaseJsonData jsonData;

        String targetId = "tv-principal";
        String action = "";
        String value = "";

        if (json.get(jsonData, "targetId")) targetId = jsonData.stringValue;
        if (json.get(jsonData, "action")) action = jsonData.stringValue;
        if (json.get(jsonData, "value")) value = jsonData.stringValue;

        if (action.length() > 0) {
            handleTvCommand(targetId, action, value);
        }
    }
}

void streamTimeoutCallback(bool timeout) {
    if (timeout) {
        Serial.println("[Stream] Tiempo de espera de Firebase agotado, reconectando stream...");
    }
}

// =========================================================================
// EJECUCIÓN DE PETICIONES HTTP LOCALES (PLACA > DISPOSITIVO VÍA WI-FI)
// =========================================================================
bool executeHttpLocalCommand(const String& url) {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[HTTP Local] Error: Wi-Fi desconectado");
        return false;
    }

    HTTPClient http;
    Serial.printf("[HTTP Local] Enviando petición Wi-Fi a: %s\n", url.c_str());

    http.begin(url);
    http.setTimeout(2500); // 2.5s máx para evitar demoras si un switch no responde

    int code = http.GET();
    bool success = (code >= 200 && code < 300);

    if (success) {
        Serial.printf("[HTTP Local] Éxito! Código HTTP: %d\n", code);
    } else {
        Serial.printf("[HTTP Local] Falló. Código: %d | Error: %s\n", code, http.errorToString(code).c_str());
    }

    http.end();
    return success;
}

// =========================================================================
// MANEJADOR: LUCES (DESPACHO VÍA WI-FI LOCAL)
// =========================================================================
void handleLightCommand(const String& lightName, bool targetState) {
    Serial.printf("[Acción Luz] Dispositivo: %s -> %s\n", lightName.c_str(), targetState ? "ENCENDER" : "APAGAR");

    // Buscar el dispositivo en nuestra tabla de configuración
    const WifiSmartDevice* targetDevice = nullptr;
    for (size_t i = 0; i < NUM_LIGHTS; i++) {
        if (lightName == SMART_LIGHTS[i].id) {
            targetDevice = &SMART_LIGHTS[i];
            break;
        }
    }

    if (!targetDevice) {
        Serial.printf("[Acción Luz] Dispositivo '%s' no encontrado en config.h\n", lightName.c_str());
        return;
    }

    // Construir la URL HTTP local según el firmware del enchufe
    String url = "http://" + String(targetDevice->ip);
    if (targetDevice->protocol == PROTO_TASMOTA) {
        // Tasmota: /cm?cmnd=Power%20On (o %20Off)
        url += "/cm?cmnd=Power%20" + String(targetState ? "On" : "Off");
    } else if (targetDevice->protocol == PROTO_SHELLY) {
        // Shelly: /relay/0?turn=on (o off)
        url += "/relay/0?turn=" + String(targetState ? "on" : "off");
    } else {
        // Genérico: /on o /off
        url += targetState ? "/on" : "/off";
    }

    // Ejecutar la petición HTTP local por Wi-Fi
    executeHttpLocalCommand(url);

    // Confirmar estado en Firebase para retroalimentar la web en Vercel
    String statePath = "/home/state/lights/" + lightName;
    Firebase.RTDB.setBool(&fbdo, statePath.c_str(), targetState);
}

// =========================================================================
// MANEJADOR: PILETA (DESPACHO VÍA WI-FI LOCAL)
// =========================================================================
void handlePoolCommand(bool targetState) {
    Serial.printf("[Acción Pileta] Bomba -> %s\n", targetState ? "ENCENDER" : "APAGAR");

    String url = "http://" + String(POOL_RELAY_IP);
    if (POOL_RELAY_PROTOCOL == PROTO_SHELLY) {
        url += "/relay/0?turn=" + String(targetState ? "on" : "off");
    } else {
        url += "/cm?cmnd=Power%20" + String(targetState ? "On" : "Off");
    }

    executeHttpLocalCommand(url);

    // Confirmar en Firebase
    Firebase.RTDB.setBool(&fbdo, "/home/state/poolOn", targetState);
}

// =========================================================================
// MANEJADOR: PORTÓN (DISPARO DE PULSO VÍA WI-FI LOCAL)
// =========================================================================
void handleGateCommand(bool targetState) {
    Serial.println("[Acción Portón] Enviando pulso de accionamiento Wi-Fi al portón...");

    // Se envía el comando al relé Wi-Fi de contacto seco
    executeHttpLocalCommand(GATE_RELAY_PULSE_URL);

    // Actualizar estado en Firebase
    Firebase.RTDB.setBool(&fbdo, "/home/state/gateOpen", targetState);
}

// =========================================================================
// MANEJADOR: TELEVISOR (COMANDOS VÍA WI-FI O INFRARROJO)
// =========================================================================
void handleTvCommand(const String& targetId, const String& action, const String& value) {
    Serial.printf("[Acción TV] Target: %s | Acción: %s | Valor: %s\n", targetId.c_str(), action.c_str(), value.c_str());

    String tvIp = TV_LIVING_IP;
    if (targetId == "tv-pedro") {
        tvIp = TV_PEDRO_IP;
    } else if (targetId == "tv-padres") {
        tvIp = TV_PADRES_IP;
    } else if (targetId == "tv-lucas") {
        tvIp = TV_LUCAS_IP;
    } else if (targetId == "tv-living") {
        tvIp = TV_LIVING_IP;
    }

    // 1. Comando de Energía (Power)
    if (action == "power") {
        Serial.printf("[TV Wi-Fi] Disparando comando Power a TV IP: %s\n", tvIp.c_str());
        
        // Emisión por señal Infrarroja (IR) de respaldo por hardware (Samsung Power Code)
        irsend.sendSamsung(0xE0E040BF, 32);
        delay(40);
        irsend.sendSamsung(0xE0E040BF, 32);

        // Si la TV tiene endpoint HTTP/REST local (ej. Android TV / Tizen / webOS)
        String url = "http://" + tvIp + ":8080/power";
        executeHttpLocalCommand(url);
    }
    // 2. Control de Volumen
    else if (action == "set_volume") {
        int vol = value.toInt();
        Serial.printf("[TV Wi-Fi] Ajustando volumen a: %d en %s\n", vol, tvIp.c_str());
        String url = "http://" + tvIp + ":8080/volume?level=" + String(vol);
        executeHttpLocalCommand(url);
    }
    // 3. Mute
    else if (action == "toggle_mute") {
        Serial.printf("[TV Wi-Fi] Alternando Silencio (Mute) en %s\n", tvIp.c_str());
        // IR Mute
        irsend.sendSamsung(0xE0E0F00F, 32);
    }
    // 4. Lanzar Aplicaciones (Netflix, YouTube, etc.)
    else if (action == "launch_app") {
        Serial.printf("[TV Wi-Fi] Lanzando app: %s en TV IP %s\n", value.c_str(), tvIp.c_str());
        String url = "http://" + tvIp + ":8080/app?name=" + value;
        executeHttpLocalCommand(url);
    }
    // 5. Teclas de Navegación D-Pad / Control Remoto
    else if (action == "remote_key") {
        Serial.printf("[TV Wi-Fi] Tecla remota: %s enviada a %s\n", value.c_str(), tvIp.c_str());
        // Despacho por código IR o HTTP
        if (value == "UP") irsend.sendSamsung(0xE0E006F9, 32);
        else if (value == "DOWN") irsend.sendSamsung(0xE0E08679, 32);
        else if (value == "LEFT") irsend.sendSamsung(0xE0E0A659, 32);
        else if (value == "RIGHT") irsend.sendSamsung(0xE0E046B9, 32);
        else if (value == "ENTER") irsend.sendSamsung(0xE0E016E9, 32);
        else if (value == "BACK") irsend.sendSamsung(0xE0E01AE5, 32);
        else if (value == "HOME") irsend.sendSamsung(0xE0E058A7, 32);
    }
}
