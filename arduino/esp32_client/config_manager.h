/*
  config_manager.h - Preferences-based configuration manager for ESP32 Client
*/

#ifndef CONFIG_MANAGER_H
#define CONFIG_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include "config.h"

struct EEPROMConfig {
  char wifi_ssid[33];
  char wifi_pass[65];
  char server_host[65];
  int server_port;
  char device_name[65];
  uint8_t show_connecting; 
  uint32_t magic;
};

extern EEPROMConfig activeConfig;
extern const uint32_t CONFIG_MAGIC;

inline void loadConfiguration() {
  Preferences prefs;
  prefs.begin("inkflow", false);
  
  String wifi_ssid = prefs.getString("wifi_ssid", "");
  String wifi_pass = prefs.getString("wifi_pass", "");
  String server_host = prefs.getString("server_host", "");
  int server_port = prefs.getInt("server_port", 0);
  String device_name = prefs.getString("device_name", "");
  uint8_t show_connecting = prefs.getUChar("show_conn", 1);
  uint32_t magic = prefs.getUInt("magic", 0);
  
  prefs.end();
  
  if (magic != CONFIG_MAGIC || wifi_ssid == "") {
    Serial.println(F("[Config] Preferences unconfigured. Loading fallback defaults from config.h..."));
    
    memset(&activeConfig, 0, sizeof(EEPROMConfig));
    strncpy(activeConfig.wifi_ssid, default_ssid.c_str(), sizeof(activeConfig.wifi_ssid) - 1);
    strncpy(activeConfig.wifi_pass, default_password.c_str(), sizeof(activeConfig.wifi_pass) - 1);
    strncpy(activeConfig.server_host, default_serverIp.c_str(), sizeof(activeConfig.server_host) - 1);
    activeConfig.server_port = default_serverPort;
    strncpy(activeConfig.device_name, default_deviceName.c_str(), sizeof(activeConfig.device_name) - 1);
    activeConfig.show_connecting = 1; 
    activeConfig.magic = CONFIG_MAGIC;
    
    // Save defaults
    prefs.begin("inkflow", false);
    prefs.putString("wifi_ssid", activeConfig.wifi_ssid);
    prefs.putString("wifi_pass", activeConfig.wifi_pass);
    prefs.putString("server_host", activeConfig.server_host);
    prefs.putInt("server_port", activeConfig.server_port);
    prefs.putString("device_name", activeConfig.device_name);
    prefs.putUChar("show_conn", activeConfig.show_connecting);
    prefs.putUInt("magic", activeConfig.magic);
    prefs.end();
    Serial.println(F("[Config] Defaults successfully written to Preferences."));
  } else {
    strncpy(activeConfig.wifi_ssid, wifi_ssid.c_str(), sizeof(activeConfig.wifi_ssid) - 1);
    strncpy(activeConfig.wifi_pass, wifi_pass.c_str(), sizeof(activeConfig.wifi_pass) - 1);
    strncpy(activeConfig.server_host, server_host.c_str(), sizeof(activeConfig.server_host) - 1);
    activeConfig.server_port = server_port;
    strncpy(activeConfig.device_name, device_name.c_str(), sizeof(activeConfig.device_name) - 1);
    activeConfig.show_connecting = show_connecting;
    activeConfig.magic = magic;
    Serial.println(F("[Config] Configurations loaded successfully from Preferences."));
  }
  
  Serial.print(F("[Config] SSID: ")); Serial.println(activeConfig.wifi_ssid);
  Serial.print(F("[Config] Server: ")); Serial.print(activeConfig.server_host);
  Serial.print(F(":")); Serial.println(activeConfig.server_port);
  Serial.print(F("[Config] Device Name: ")); Serial.println(activeConfig.device_name);
}

inline void saveConfiguration(const char* ssidVal, const char* passVal, const char* hostVal, int portVal, const char* nameVal, uint8_t showConnectingVal = 1) {
  Preferences prefs;
  prefs.begin("inkflow", false);
  
  prefs.putString("wifi_ssid", ssidVal);
  prefs.putString("wifi_pass", passVal);
  prefs.putString("server_host", hostVal);
  prefs.putInt("server_port", portVal);
  prefs.putString("device_name", nameVal);
  prefs.putUChar("show_conn", showConnectingVal);
  prefs.putUInt("magic", CONFIG_MAGIC);
  
  prefs.end();
  
  // Update local struct
  strncpy(activeConfig.wifi_ssid, ssidVal, sizeof(activeConfig.wifi_ssid) - 1);
  strncpy(activeConfig.wifi_pass, passVal, sizeof(activeConfig.wifi_pass) - 1);
  strncpy(activeConfig.server_host, hostVal, sizeof(activeConfig.server_host) - 1);
  activeConfig.server_port = portVal;
  strncpy(activeConfig.device_name, nameVal, sizeof(activeConfig.device_name) - 1);
  activeConfig.show_connecting = showConnectingVal;
  activeConfig.magic = CONFIG_MAGIC;
  
  Serial.println(F("[Config] New configuration written securely to Preferences."));
}

#endif // CONFIG_MANAGER_H
