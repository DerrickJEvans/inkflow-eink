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
    console.log(`[Scheduler] Fetching background data for [${pluginId}] on device [${device.id}]...`);
    const data = await PLUGINS[pluginId].fetchData(settings[pluginId] || {}, device);
    
    const cachePath = getCachePath(device.id, pluginId);
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
  
  // Trigger initial fetch loop asynchronously on startup
  setTimeout(runAllFetches, 1000);

  // Run fetches every 4 minutes (240,000ms) to ensure timetables and feeds stay fresh
  setInterval(runAllFetches, 240000);
};

module.exports = {
  start,
  getCachePath
};
