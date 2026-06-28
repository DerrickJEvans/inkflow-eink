/*
  config_manager.h - EEPROM and configuration loader/saver for Arduino UNO R4 Client
*/

#ifndef CONFIG_MANAGER_H
#define CONFIG_MANAGER_H

#include <Arduino.h>
#include <EEPROM.h>
#include "config.h"

// EEPROM storage structured configuration schema
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

// Reads EEPROM settings, falling back to config.h defaults on first run
inline void loadConfiguration() {
  EEPROM.get(0, activeConfig);
  
  if (activeConfig.magic != CONFIG_MAGIC) {
    Serial.println(F("[Config] EEPROM unconfigured. Loading fallback defaults from config.h..."));
    
    // Clear and set defaults
    memset(&activeConfig, 0, sizeof(EEPROMConfig));
    
    strncpy(activeConfig.wifi_ssid, default_ssid.c_str(), sizeof(activeConfig.wifi_ssid) - 1);
    strncpy(activeConfig.wifi_pass, default_password.c_str(), sizeof(activeConfig.wifi_pass) - 1);
    strncpy(activeConfig.server_host, default_serverIp.c_str(), sizeof(activeConfig.server_host) - 1);
    activeConfig.server_port = default_serverPort;
    strncpy(activeConfig.device_name, default_deviceName.c_str(), sizeof(activeConfig.device_name) - 1);
    activeConfig.show_connecting = 1; // Show connecting splash on first boot
    activeConfig.magic = CONFIG_MAGIC;
    
    // Save defaults to EEPROM so they persist
    EEPROM.put(0, activeConfig);
    Serial.println(F("[Config] Defaults successfully written to EEPROM."));
  } else {
    Serial.println(F("[Config] Configurations loaded successfully from EEPROM."));
  }
  
  Serial.print(F("[Config] SSID: ")); Serial.println(activeConfig.wifi_ssid);
  Serial.print(F("[Config] Server: ")); Serial.print(activeConfig.server_host);
  Serial.print(F(":")); Serial.println(activeConfig.server_port);
  Serial.print(F("[Config] Device Name: ")); Serial.println(activeConfig.device_name);
}

// Writes active configurations to non-volatile EEPROM
inline void saveConfiguration(const char* ssidVal, const char* passVal, const char* hostVal, int portVal, const char* nameVal, uint8_t showConnectingVal = 1) {
  memset(&activeConfig, 0, sizeof(EEPROMConfig));
  
  strncpy(activeConfig.wifi_ssid, ssidVal, sizeof(activeConfig.wifi_ssid) - 1);
  strncpy(activeConfig.wifi_pass, passVal, sizeof(activeConfig.wifi_pass) - 1);
  strncpy(activeConfig.server_host, hostVal, sizeof(activeConfig.server_host) - 1);
  activeConfig.server_port = portVal;
  strncpy(activeConfig.device_name, nameVal, sizeof(activeConfig.device_name) - 1);
  activeConfig.show_connecting = showConnectingVal;
  activeConfig.magic = CONFIG_MAGIC;
  
  EEPROM.put(0, activeConfig);
  Serial.println(F("[Config] New configuration written securely to EEPROM."));
}

#endif // CONFIG_MANAGER_H
