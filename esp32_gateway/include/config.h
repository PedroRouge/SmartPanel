#pragma once
#include <Arduino.h>

enum DeviceProtocol {
    PROTO_TASMOTA,
    PROTO_SHELLY,
    PROTO_GENERIC
};

struct WifiSmartDevice {
    const char* id;
    const char* ip;
    DeviceProtocol protocol;
};

#if __has_include("config.local.h")
#include "config.local.h"
#else
#error "Missing config.local.h. Copy config.example.h and set local values."
#endif

#ifndef WIFI_SSID
#error "WIFI_SSID must be defined in config.local.h"
#endif
#ifndef WIFI_PASSWORD
#error "WIFI_PASSWORD must be defined in config.local.h"
#endif
#ifndef FIREBASE_API_KEY
#error "FIREBASE_API_KEY must be defined in config.local.h"
#endif
#ifndef FIREBASE_DATABASE_URL
#error "FIREBASE_DATABASE_URL must be defined in config.local.h"
#endif
#ifndef FIREBASE_USER_EMAIL
#error "FIREBASE_USER_EMAIL must be defined in config.local.h"
#endif
#ifndef FIREBASE_USER_PASSWORD
#error "FIREBASE_USER_PASSWORD must be defined in config.local.h"
#endif
#ifndef SMART_PANEL_LOCAL_NETWORK_CONFIG
#error "Local device IP configuration must be defined in config.local.h"
#endif