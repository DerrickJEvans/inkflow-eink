// scheduler.js - Background Caching Scheduler for E-Ink Widgets
const fs = require('fs');
const path = require('path');
const { PLUGINS } = require('./renderer');

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

let configRef = null;
let saveConfigRef = null;

const getCachePath = (deviceId, pluginId) => {
  return path.join(CACHE_DIR, `data_${deviceId}_${pluginId}.json`);
};

/**
 * Invokes a plugin's fetchData and saves JSON output to local cache
 */
const fetchAndCachePlugin = async (device, pluginId, settings) => {
  if (!PLUGINS[pluginId]) return;
  try {
    const globalPluginSettings = settings[pluginId] || {};
    const devicePluginSettings = (device.settings && device.settings[pluginId]) || {};
    const mergedSettings = { ...globalPluginSettings, ...devicePluginSettings };

    const cachePath = getCachePath(device.id, pluginId);
    if (fs.existsSync(cachePath)) {
      const stats = fs.statSync(cachePath);
      const refreshHours = parseFloat(mergedSettings.refreshHours) || 0;
      const refreshMinutes = parseFloat(mergedSettings.refreshMinutes) || 0;
      const totalRefreshMs = (refreshHours * 60 * 60 * 1000) + (refreshMinutes * 60 * 1000);

      if (totalRefreshMs > 0) {
        const cacheAgeMs = Date.now() - stats.mtimeMs;
        if (cacheAgeMs < totalRefreshMs) {
          console.log(`[Scheduler] Skipping [${pluginId}] for device [${device.id}] - Cache is fresh (age: ${(cacheAgeMs / 60000).toFixed(2)}m / target: ${refreshHours}h ${refreshMinutes}m)`);
          return;
        }
      }
    }

    console.log(`[Scheduler] Fetching background data for [${pluginId}] on device [${device.id}]...`);
    const data = await PLUGINS[pluginId].fetchData(mergedSettings, device);
    
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
    
    // Save configuration if indexes were mutated (e.g. sequential rss or xkcd index advance)
    if (saveConfigRef) {
      saveConfigRef();
    }
  } catch (err) {
    console.error(`[Scheduler] Caching failed for [${pluginId}] on device [${device.id}]:`, err.message);
  }
};

/**
 * Loops through all active devices and active plugins to cache their JSON payloads
 */
const runAllFetches = async () => {
  if (!configRef) return;
  const devices = configRef.devices || [];
  const settings = configRef.settings || {};

  console.log(`[Scheduler] Running periodic caching sweep for ${devices.length} screens...`);
  for (const device of devices) {
    const activePlugins = device.activePlugins || [];
    for (const pluginId of activePlugins) {
      await fetchAndCachePlugin(device, pluginId, settings);
    }
  }
  console.log("[Scheduler] Caching sweep complete.");
};

/**
 * Initializes the background timer loop
 */
const start = (sharedConfig, sharedSaveConfig) => {
  configRef = sharedConfig;
  saveConfigRef = sharedSaveConfig;

  console.log("[Scheduler] Decoupled Caching Scheduler initialized.");
  
  // Trigger initial fetch loop after 25 seconds to allow network interfaces to fully associate on boot!
  setTimeout(runAllFetches, 25000);

  // Run fetches every 4 minutes (240,000ms) to ensure timetables and feeds stay fresh
  setInterval(runAllFetches, 240000);
};

module.exports = {
  start,
  getCachePath
};
