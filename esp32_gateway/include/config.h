#pragma once
#include <Arduino.h>

// =========================================================================
// 1. CONFIGURACIÓN WI-FI DEL HOGAR
// =========================================================================
#define WIFI_SSID       "TU_WIFI_SSID"        // Nombre de tu red Wi-Fi (2.4 GHz)
#define WIFI_PASSWORD   "TU_WIFI_PASSWORD"    // Contraseña de tu red Wi-Fi

// =========================================================================
// 2. CONFIGURACIÓN FIREBASE (AUTENTICACIÓN SEGURA OBLIGATORIA)
// =========================================================================
// API Key de Firebase Console > Configuración del Proyecto > Claves de API web
#define FIREBASE_API_KEY       "AIzaSy_TU_API_KEY_DE_FIREBASE"
// URL de tu base de datos (terminada en .firebaseio.com sin '/' al final)
#define FIREBASE_DATABASE_URL  "https://tu-proyecto-smartpanel-default-rtdb.firebaseio.com"

// Usuario y Contraseña para el ESP32 en Firebase Authentication
// (Crea este usuario en Firebase Console > Authentication > Users)
#define FIREBASE_USER_EMAIL    "esp32@smartpanel.local"
#define FIREBASE_USER_PASSWORD "Pr484014228520."

// =========================================================================
// 3. MAPEO DE DISPOSITIVOS LOCALES EN LA RED WI-FI (LAN)
// La placa ESP32 enviará peticiones HTTP directamente a estas direcciones IP
// =========================================================================

// Tipos de dispositivos admitidos para comunicación HTTP local:
enum DeviceProtocol {
    PROTO_TASMOTA,  // http://IP/cm?cmnd=Power%20On (o Off)
    PROTO_SHELLY,   // http://IP/relay/0?turn=on (o off)
    PROTO_GENERIC   // http://IP/on o http://IP/off
};

struct WifiSmartDevice {
    const char* id;          // Identificador en Firebase (ej. living, kitchen, etc.)
    const char* ip;          // IP local fija del switch/enchufe
    DeviceProtocol protocol; // Protocolo HTTP del switch
};

// Configura aquí las IPs fijas de tus enchufes/switches en tu red Wi-Fi local:
const WifiSmartDevice SMART_LIGHTS[] = {
    { "living",   "192.168.1.150", PROTO_TASMOTA },
    { "kitchen",  "192.168.1.151", PROTO_SHELLY },
    { "bedroom",  "192.168.1.152", PROTO_TASMOTA },
    { "garden",   "192.168.1.153", PROTO_SHELLY }
};
const size_t NUM_LIGHTS = sizeof(SMART_LIGHTS) / sizeof(SMART_LIGHTS[0]);

// Relé Wi-Fi de la Bomba de Pileta (ej. Shelly 1PM o Sonoff POW)
#define POOL_RELAY_IP         "192.168.1.160"
#define POOL_RELAY_PROTOCOL   PROTO_SHELLY

// Relé Wi-Fi del Portón Levadizo/Corredizo (ej. Shelly 1 con contacto seco para pulso)
#define GATE_RELAY_IP         "192.168.1.161"
#define GATE_RELAY_PULSE_URL  "http://192.168.1.161/relay/0?turn=on&timer=1" // Pulso de 1 segundo

// =========================================================================
// 4. TELEVISORES VÍA WI-FI / EMISOR INFRARROJO (IR)
// =========================================================================
#define IR_SEND_PIN           4     // Pin GPIO conectado al transistor y LED emisor IR
#define ANDROID_TV_LIVING_IP  "192.168.1.180" // IP local de la TV Principal
#define ANDROID_TV_BEDROOM_IP "192.168.1.181" // IP local de la TV Dormitorio
