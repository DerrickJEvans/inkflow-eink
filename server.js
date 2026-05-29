// server.js - Main Express Server and API Endpoints
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { renderDeviceImage, PLUGINS, loadPlugins } = require('./renderer');
const scheduler = require('./scheduler');
const aiCore = require('./ai_core');
const dns = require('dns');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Ensure directories exist
const CACHE_DIR = path.join(__dirname, 'cache');
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Load configuration
let configPath = path.join(__dirname, 'config.json');
let configExamplePath = path.join(__dirname, 'config.example.json');
let config = { devices: [], settings: {} };

if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
  try {
    fs.copyFileSync(configExamplePath, configPath);
    console.log("Created config.json from config.example.json");
  } catch (err) {
    console.error("Error copying config.example.json to config.json:", err);
  }
}

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error("Error reading config.json, using defaults", err);
  }
}

const saveConfig = () => {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error("Error saving config.json:", err);
  }
};

const clearDeviceJsonCache = (deviceId) => {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      files.forEach(file => {
        if (file.startsWith(`data_${deviceId}_`) && file.endsWith('.json')) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        }
      });
      console.log(`[Cache] Cleared JSON data cache for device: ${deviceId}`);
    }
  } catch (err) {
    console.error(`[Cache] Failed to clear JSON cache for device ${deviceId}:`, err);
  }
};

const clearAllJsonCache = () => {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      files.forEach(file => {
        if (file.startsWith('data_') && file.endsWith('.json')) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        }
      });
      console.log(`[Cache] Cleared all JSON data cache files.`);
    }
  } catch (err) {
    console.error(`[Cache] Failed to clear JSON cache:`, err);
  }
};

// Start background scheduler for decoupled cache updates
scheduler.start(config, saveConfig);

// Memory cache for compiled screen data
const imageCache = {};

/**
 * Records device connection network details and resolves local mDNS hostname asynchronously
 */
const recordDeviceConnection = (device, req) => {
  try {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!ip) return;
    
    // Clean IPv4 mapped to IPv6 addresses
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    if (ip === '::1') ip = '127.0.0.1';
    
    let changed = false;
    if (device.lastIp !== ip) {
      device.lastIp = ip;
      changed = true;
    }
    
    const nowStr = new Date().toISOString();
    if (device.lastSeen !== nowStr) {
      device.lastSeen = nowStr;
      changed = true;
    }

    // Capture telemetry headers from physical TRMNL BYOS hardware
    const battery = req.headers['battery-voltage'];
    const fw = req.headers['fw-version'];
    const rssi = req.headers['rssi'];

    // Identify Client Firmware Type Symmetrically
    let clientType = device.clientType || "InkFlow C++ Client";
    const reqPath = req.path || "";
    const userAgent = req.headers['user-agent'] || "";

    if (reqPath === '/api/display/raw') {
      if (fw && fw.includes('InkFlow-ESP32')) {
        clientType = "InkFlow ESP32 Client";
      } else if (fw && fw.includes('InkFlow-R4')) {
        clientType = "InkFlow UNO R4 Client";
      } else {
        clientType = "InkFlow C++ Client";
      }
    } else if (reqPath === '/api/display/image.png') {
      if (userAgent.toLowerCase().includes('python-requests') || (fw && fw.includes('InkFlow-Python'))) {
        clientType = "InkFlow Python Client";
      } else {
        clientType = "Web Preview / API";
      }
    } else if (reqPath === '/api/display' || reqPath === '/api/setup') {
      clientType = "Official TRMNL Firmware";
    }

    if (device.clientType !== clientType) {
      device.clientType = clientType;
      changed = true;
      console.log(`[Device Telemetry][${device.id}] Identified Client Type: ${clientType}`);
    }

    if (battery && device.batteryVoltage !== battery) {
      device.batteryVoltage = battery;
      changed = true;
      console.log(`[Device Telemetry][${device.id}] Updated Battery Voltage: ${battery}`);
    }
    if (fw && device.fwVersion !== fw) {
      device.fwVersion = fw;
      changed = true;
      console.log(`[Device Telemetry][${device.id}] Updated Firmware Version: ${fw}`);
    }
    if (rssi && device.rssi !== rssi) {
      device.rssi = rssi;
      changed = true;
      console.log(`[Device Telemetry][${device.id}] Updated WiFi RSSI: ${rssi} dBm`);
    }
    
    if (changed) {
      saveConfig();
    }
    
    // Asynchronously perform reverse lookup to resolve local mDNS or domain names
    if (ip && ip !== '127.0.0.1') {
      dns.reverse(ip, (err, hostnames) => {
        if (!err && hostnames && hostnames.length > 0) {
          const resolvedHost = hostnames[0];
          if (device.lastHostname !== resolvedHost) {
            device.lastHostname = resolvedHost;
            saveConfig();
            console.log(`[Network Diagnostics] Resolved hostname for device ${device.id}: ${resolvedHost}`);
          }
        }
      });
    }
  } catch (err) {
    console.error("[Network Diagnostics] Error recording device connection:", err);
  }
};

/**
 * Gets or creates a device config based on ID
 */
const getOrCreateDevice = (deviceId, reqQuery = {}) => {
  let device = config.devices.find(d => d.id === deviceId);
  
  if (!device) {
    // Auto-Register new device!
    const width = parseInt(reqQuery.width) || 800;
    const height = parseInt(reqQuery.height) || 480;
    const name = `Auto-Registered ${deviceId.toUpperCase()}`;

    device = {
      id: deviceId,
      name: name,
      width: width,
      height: height,
      refreshRate: 1800, // 30 minutes default
      activePlugins: ["system", "weather", "rss", "notes"]
    };

    config.devices.push(device);
    saveConfig();
    console.log(`[Auto-Registration] Registered new device: ${deviceId} (${width}x${height})`);
  }
  return device;
};

/**
 * Checks cache validity and rebuilds if needed
 */
const fetchDeviceDisplayData = async (device, forceRefresh = false) => {
  if (forceRefresh) {
    clearDeviceJsonCache(device.id);
  }
  const cacheKey = device.id;
  const now = Date.now();
  const cached = imageCache[cacheKey];
  
  // Resolve dynamic refresh rate for Carousel Mode
  let refreshRate = device.refreshRate || 1800;
  if (device.activePlugins && device.activePlugins.length > 0) {
    const activePlugins = device.activePlugins.filter(pId => PLUGINS[pId]);
    if (activePlugins.length > 0) {
      const currentIndex = device.currentPluginIndex || 0;
      const currentPlugin = activePlugins[currentIndex % activePlugins.length];
      if (device.rotationIntervals && device.rotationIntervals[currentPlugin]) {
        refreshRate = parseInt(device.rotationIntervals[currentPlugin]) || refreshRate;
      }
    }
  }
  
  const cacheDurationMs = refreshRate * 1000;

  if (cached && !forceRefresh && (now - cached.timestamp < cacheDurationMs)) {
    return cached.data;
  }

  console.log(`[Renderer] Compiling screen elements for device: ${device.id} (Interval: ${refreshRate}s)...`);
  try {
    const rendered = await renderDeviceImage(device, config.settings);
    saveConfig();
    
    // Update local cache and include the calculated refresh rate
    imageCache[cacheKey] = {
      timestamp: now,
      data: rendered,
      refreshRate: refreshRate
    };

    // Save persistent PNG copy in cache folder for absolute URLs
    fs.writeFileSync(path.join(CACHE_DIR, `${device.id}.png`), rendered.png);
    fs.writeFileSync(path.join(CACHE_DIR, `${device.id}.raw`), rendered.raw);

    // In Carousel Mode, advance the plugin index for the NEXT poll request!
    if (device.activePlugins && device.activePlugins.length > 1) {
      const activePlugins = device.activePlugins.filter(pId => PLUGINS[pId]);
      if (activePlugins.length > 1) {
        const currentIndex = parseInt(device.currentPluginIndex) || 0;
        device.currentPluginIndex = (currentIndex + 1) % activePlugins.length;
        saveConfig();
        console.log(`[Rotation] Advanced device ${device.id} to plugin index ${device.currentPluginIndex} for the next refresh.`);
      }
    }

    return rendered;
  } catch (err) {
    console.error(`[Renderer] Error rendering image for ${device.id}:`, err);
    if (cached) {
      console.log(`[Renderer] Serving stale cache due to render failure.`);
      return cached.data;
    }
    throw err;
  }
};

/**
 * Resolves the dynamic battery deep sleep interval for the device.
 * Checks TfL and UK Train caches for disruptions/delays.
 * Returns 300 (5 minutes) if active disruption is found, else 1800 (30 minutes).
 */
const resolveDeepSleepInterval = (device) => {
  try {
    const activePlugins = device.activePlugins || [];
    for (const pluginId of activePlugins) {
      if (pluginId === 'tfl') {
        const cachePath = path.join(CACHE_DIR, `data_${device.id}_tfl.json`);
        if (fs.existsSync(cachePath)) {
          const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          if (data && Array.isArray(data.lines)) {
            const hasDisruption = data.lines.some(l => l.severity !== 10);
            if (hasDisruption) {
              console.log(`[Deep Sleep] TfL disruption detected for ${device.id}. Deep sleep interval set to 300s.`);
              return 300;
            }
          }
        }
      }
      if (pluginId === 'uk_trains') {
        const cachePath = path.join(CACHE_DIR, `data_${device.id}_uk_trains.json`);
        if (fs.existsSync(cachePath)) {
          const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          if (data) {
            if (Array.isArray(data.alerts) && data.alerts.length > 0) {
              console.log(`[Deep Sleep] UK Trains alert detected for ${device.id}. Deep sleep interval set to 300s.`);
              return 300;
            }
            if (Array.isArray(data.services)) {
              const hasDelay = data.services.some(s => {
                if (s.isCancelled) return true;
                const status = (s.status || "").toLowerCase();
                if (status.includes("delayed") || status.includes("late") || status.includes("cancel")) return true;
                return false;
              });
              if (hasDelay) {
                console.log(`[Deep Sleep] UK Trains delay/cancellation detected for ${device.id}. Deep sleep interval set to 300s.`);
                return 300;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Deep Sleep] Error resolving sleep interval for ${device.id}:`, err);
  }
  return 1800;
};

// ==========================================
//              API ENDPOINTS
// ==========================================

// Get list of all loaded plugins
app.get('/api/plugins', (req, res) => {
  try {
    const list = Object.keys(PLUGINS).map(key => ({
      id: PLUGINS[key].id,
      name: PLUGINS[key].name,
      description: PLUGINS[key].description,
      configFields: PLUGINS[key].configFields || []
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: "Failed to load plugins list" });
  }
});

// Symmetrical Deletion and Cleanup of AI-Generated widgets
app.delete('/api/plugins/:pluginId', (req, res) => {
  try {
    const { pluginId } = req.params;
    if (!pluginId) return res.status(400).json({ error: "Plugin ID is required" });

    // Protect core system plugins from deletion
    const corePluginIds = ['weather', 'system', 'rss', 'notes', 'tfl', 'uk_trains', 'xkcd', 'world_clock', 'ai_briefing', 'ai_advisor', 'airport_board', 'tide_timetable'];
    if (corePluginIds.includes(pluginId)) {
      return res.status(403).json({ error: "Cannot delete core system plugins." });
    }

    const pluginFilePath = path.join(__dirname, 'plugins', `${pluginId}.js`);
    if (fs.existsSync(pluginFilePath)) {
      fs.unlinkSync(pluginFilePath);
      console.log(`[AI Widget Cleanup] Deleted plugin file: ${pluginFilePath}`);
    } else {
      return res.status(404).json({ error: "Widget plugin file not found on disk." });
    }

    // Hot-reload plugins to sync and prune memory dictionary PLUGINS
    loadPlugins();

    let configUpdated = false;

    // Remove plugin from all devices' activePlugins rotation lists and rotation intervals
    if (config.devices && Array.isArray(config.devices)) {
      config.devices.forEach(device => {
        if (device.activePlugins && Array.isArray(device.activePlugins)) {
          const originalLength = device.activePlugins.length;
          device.activePlugins = device.activePlugins.filter(id => id !== pluginId);
          if (device.activePlugins.length === 0) {
            device.activePlugins = ["system"]; // fallback
          }
          if (device.activePlugins.length !== originalLength) {
            configUpdated = true;
            // Align rotation sequence index if needed
            if (device.currentPluginIndex >= device.activePlugins.length) {
              device.currentPluginIndex = 0;
            }
          }
        }
        if (device.rotationIntervals && device.rotationIntervals[pluginId]) {
          delete device.rotationIntervals[pluginId];
          configUpdated = true;
        }
      });
    }

    // Clean up settings for this plugin
    if (config.settings && config.settings[pluginId]) {
      delete config.settings[pluginId];
      configUpdated = true;
    }

    if (configUpdated) {
      saveConfig();
    }

    // Clean up all JSON data cache files associated with this plugin
    try {
      if (fs.existsSync(CACHE_DIR)) {
        const files = fs.readdirSync(CACHE_DIR);
        files.forEach(file => {
          if (file.endsWith(`_${pluginId}.json`)) {
            fs.unlinkSync(path.join(CACHE_DIR, file));
            console.log(`[AI Widget Cleanup] Purged JSON cache file: ${file}`);
          }
        });
      }
    } catch (cacheErr) {
      console.error(`[AI Widget Cleanup] Error purging caches for plugin ${pluginId}:`, cacheErr);
    }

    // Invalidate screen imageCache in memory for all devices
    config.devices.forEach(d => {
      delete imageCache[d.id];
    });

    res.json({ success: true, message: `Dynamic widget '${pluginId}' deleted successfully and rotation sequences cleaned up.` });
  } catch (err) {
    console.error(`[AI Widget Cleanup] Error during deletion of plugin ${pluginId}:`, err);
    res.status(500).json({ error: `Deletion failed: ${err.message}` });
  }
});

// AI Widget Builder endpoint
app.post('/api/ai/build', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log(`[AI Widget Builder] Request received: "${prompt}"`);

    // Call Gemini to generate plugin code
    const result = await aiCore.generatePluginCode(prompt);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    const { pluginId, code } = result;

    // Write file to plugins directory
    const pluginFilePath = path.join(__dirname, 'plugins', `${pluginId}.js`);
    fs.writeFileSync(pluginFilePath, code, 'utf8');
    console.log(`[AI Widget Builder] Successfully saved generated plugin to ${pluginFilePath}`);

    // Dynamic hot reload of all plugins!
    loadPlugins();

    // Verify it loaded successfully
    if (!PLUGINS[pluginId]) {
      return res.status(500).json({ error: "Plugin was written but failed to compile and load dynamically." });
    }

    // Invalidate the cache for all devices so they show up
    config.devices.forEach(d => {
      delete imageCache[d.id];
    });

    res.json({
      success: true,
      message: `Widget '${PLUGINS[pluginId].name}' (${pluginId}) generated and registered successfully!`,
      pluginId: pluginId,
      plugin: {
        id: pluginId,
        name: PLUGINS[pluginId].name,
        description: PLUGINS[pluginId].description
      }
    });
  } catch (err) {
    console.error("[AI Widget Builder] Endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get host Raspberry Pi system metrics
app.get('/api/system-stats', async (req, res) => {
  try {
    const stats = await PLUGINS.system.fetchData({});
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Failed to gather system statistics" });
  }
});

let ollamaPullState = {
  active: false,
  model: null,
  status: 'idle',
  percent: 0,
  error: null
};

// GET AI Configuration and Environment Variables (Masked)
app.get('/api/ai/env', (req, res) => {
  try {
    const dotenv = require('dotenv');
    let envVars = {};
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      envVars = dotenv.parse(fs.readFileSync(envPath));
    }

    const geminiKey = envVars.GEMINI_API_KEY || '';
    const groqKey = envVars.GROQ_API_KEY || '';

    // Simple helper to mask credentials
    const maskKey = (key) => {
      if (!key) return '';
      if (key.length <= 10) return '••••••••';
      return `${key.substring(0, 6)}••••••••${key.substring(key.length - 4)}`;
    };

    res.json({
      geminiKey: maskKey(geminiKey),
      hasGeminiKey: !!geminiKey,
      groqKey: maskKey(groqKey),
      hasGroqKey: !!groqKey,
      widgetBuilderProvider: envVars.WIDGET_BUILDER_AI_PROVIDER || 'gemini',
      dynamicWidgetsProvider: envVars.DYNAMIC_WIDGETS_AI_PROVIDER || 'gemini',
      ollamaHost: envVars.OLLAMA_HOST || 'http://localhost:11434',
      ollamaModel: envVars.OLLAMA_MODEL || 'llama3.2:1b'
    });
  } catch (err) {
    console.error("[AI Env Config] Error getting env variables:", err);
    res.status(500).json({ error: "Failed to read environment configurations" });
  }
});

// POST AI Configuration and Environment Variables
app.post('/api/ai/env', (req, res) => {
  try {
    const { geminiKey, groqKey, widgetBuilderProvider, dynamicWidgetsProvider, ollamaHost, ollamaModel } = req.body;
    const dotenv = require('dotenv');
    const envPath = path.join(__dirname, '.env');
    
    let currentEnv = {};
    if (fs.existsSync(envPath)) {
      currentEnv = dotenv.parse(fs.readFileSync(envPath));
    }

    // Capture and validate incoming credentials
    let finalGeminiKey = geminiKey;
    if (geminiKey.includes('•••')) {
      finalGeminiKey = currentEnv.GEMINI_API_KEY || ''; // preserve existing
    }
    
    let finalGroqKey = groqKey;
    if (groqKey.includes('•••')) {
      finalGroqKey = currentEnv.GROQ_API_KEY || ''; // preserve existing
    }

    // Merge changes
    const updatedEnv = {
      ...currentEnv,
      GEMINI_API_KEY: finalGeminiKey,
      GROQ_API_KEY: finalGroqKey,
      WIDGET_BUILDER_AI_PROVIDER: widgetBuilderProvider || 'gemini',
      DYNAMIC_WIDGETS_AI_PROVIDER: dynamicWidgetsProvider || 'gemini',
      OLLAMA_HOST: ollamaHost || 'http://localhost:11434',
      OLLAMA_MODEL: ollamaModel || 'llama3.2:1b'
    };

    // Construct .env file string
    let envContent = '';
    for (const [key, val] of Object.entries(updatedEnv)) {
      envContent += `${key}=${val}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log("[AI Env Config] Environmental variables updated. Initiating memory hot-reload...");

    // Trigger AI Config reload dynamically in server memory!
    const reloadSuccess = aiCore.reloadAiConfig();

    if (reloadSuccess) {
      res.json({ success: true, message: "AI Engine configurations updated and hot-reloaded successfully!" });
    } else {
      res.status(500).json({ error: "Configuration saved to disk, but failed to hot-reload in-memory generative clients." });
    }
  } catch (err) {
    console.error("[AI Env Config] Error writing env variables:", err);
    res.status(500).json({ error: `Save failed: ${err.message}` });
  }
});

// GET Local Ollama Status & Downloaded Models
app.get('/api/ai/ollama/status', async (req, res) => {
  try {
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    
    // Asynchronously ping Ollama tags API
    const response = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      throw new Error(`Ollama returned HTTP status ${response.status}`);
    }
    
    const data = await response.json();
    const models = (data.models || []).map(m => {
      // Human-readable size converter (GB)
      const sizeGB = m.size ? `${(m.size / (1024 * 1024 * 1024)).toFixed(2)} GB` : 'Unknown size';
      return {
        name: m.name,
        size: sizeGB,
        parameter_size: m.details ? m.details.parameter_size : 'Unknown',
        quantization_level: m.details ? m.details.quantization_level : 'Unknown'
      };
    });
    
    res.json({
      online: true,
      host: ollamaHost,
      models: models
    });
  } catch (err) {
    res.json({
      online: false,
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      error: `Local Ollama instance unreachable: ${err.message}`
    });
  }
});

// POST Pull New Local Ollama Model (Background stream reader)
app.post('/api/ai/ollama/pull', async (req, res) => {
  try {
    const { model } = req.body;
    if (!model) {
      return res.status(400).json({ error: "Model name is required" });
    }
    
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    
    // Check if a download is already in progress
    if (ollamaPullState.active && ollamaPullState.status !== 'completed' && ollamaPullState.status !== 'failed') {
      return res.status(400).json({ error: `Model pull in progress: actively downloading ${ollamaPullState.model}` });
    }
    
    // Spawn background task asynchronously to pull model and parse progress
    ollamaPullState = {
      active: true,
      model: model,
      status: 'connecting',
      percent: 0,
      error: null
    };
    
    // Asynchronous background trigger
    (async () => {
      try {
        console.log(`[Ollama Admin] Triggering background pull for: "${model}"`);
        const response = await fetch(`${ollamaHost}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: true })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP pull request failed with code ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              ollamaPullState.status = parsed.status || 'downloading';
              if (parsed.total && parsed.completed) {
                ollamaPullState.percent = Math.round((parsed.completed / parsed.total) * 100);
              }
            } catch (errLine) {
              // Ignore line parsing error for broken chunks
            }
          }
        }
        
        ollamaPullState.status = 'completed';
        ollamaPullState.percent = 100;
        console.log(`[Ollama Admin] Background pull successfully completed for: "${model}"`);
      } catch (errPull) {
        console.error(`[Ollama Admin] Background pull failed for: "${model}":`, errPull.message);
        ollamaPullState.status = 'failed';
        ollamaPullState.error = errPull.message;
      }
    })();
    
    res.json({ success: true, message: `Model download for '${model}' started asynchronously in the background.` });
  } catch (err) {
    console.error("[Ollama Admin] Pull endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET Active Ollama Pull Status (Polling endpoint)
app.get('/api/ai/ollama/pull-status', (req, res) => {
  res.json(ollamaPullState);
});

// Get global settings and devices
app.get('/api/settings', (req, res) => {
  res.json({
    ...config,
    aiEngines: {
      widgetBuilder: aiCore.getWidgetBuilderEngine(),
      dynamicWidgets: aiCore.getDynamicWidgetsEngine()
    }
  });
});

// Update global settings and devices
app.post('/api/settings', (req, res) => {
  try {
    const { devices, settings } = req.body;
    
    if (devices) {
      // Merge incoming devices with existing ones to avoid deleting auto-registered devices
      devices.forEach(incomingDevice => {
        let existingDevice = config.devices.find(d => d.id === incomingDevice.id);
        if (existingDevice) {
          // Update properties of the existing device
          Object.assign(existingDevice, incomingDevice);
        } else {
          // Add new device
          config.devices.push(incomingDevice);
        }
      });
    }
    
    if (settings) {
      config.settings = settings;
      clearAllJsonCache();
    }
    
    // Invalidate ALL device image caches on settings change
    config.devices.forEach(d => {
      delete imageCache[d.id];
    });
    
    saveConfig();
    res.json({ success: true, message: "Settings saved successfully!" });
  } catch (err) {
    console.error("Error saving settings:", err);
    res.status(500).json({ error: "Failed to update configuration settings" });
  }
});

// Direct PNG Display URL - polls & serves PNG directly
app.get('/api/display/image.png', async (req, res) => {
  try {
    const deviceId = req.query.device || (config.devices[0] ? config.devices[0].id : 'default_screen');
    const force = req.query.force === 'true';
    
    const device = getOrCreateDevice(deviceId, req.query);
    recordDeviceConnection(device, req);
    const data = await fetchDeviceDisplayData(device, force);
    
    const cached = imageCache[deviceId];
    const rate = (cached && cached.refreshRate) ? cached.refreshRate : (device.refreshRate || 1800);
    const sleepInterval = resolveDeepSleepInterval(device);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Refresh-Rate', rate.toString());
    res.setHeader('X-Trmnl-Deep-Sleep', sleepInterval.toString());
    res.send(data.png);
  } catch (err) {
    console.error(err);
    res.status(500).send("Render engine error");
  }
});

// Single widget preview PNG renderer
app.get('/api/display/preview-plugin.png', async (req, res) => {
  try {
    const pluginId = req.query.plugin;
    if (!pluginId || !PLUGINS[pluginId]) {
      return res.status(404).send("Plugin not found");
    }

    const width = parseInt(req.query.width) || 800;
    const height = parseInt(req.query.height) || 480;
    const ditherMode = req.query.dither || 'floyd-steinberg';

    // Clear JSON cache for this specific plugin under preview_temp to force fresh fetches
    const cacheFile = path.join(CACHE_DIR, `data_preview_temp_${pluginId}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        fs.unlinkSync(cacheFile);
      } catch (e) {
        console.error("Failed to clear preview cache:", e);
      }
    }

    const mockDevice = {
      id: 'preview_temp',
      name: 'Preview',
      width,
      height,
      activePlugins: [pluginId],
      layoutMode: 'rotation',
      currentPluginIndex: 0,
      ditherMode
    };

    const data = await renderDeviceImage(mockDevice, config.settings);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(data.png);
  } catch (err) {
    console.error("Preview render engine error:", err);
    res.status(500).send("Preview render engine error");
  }
});

// Direct RAW 1-bit monochrome byte stream URL (for ESP32 client)
app.get('/api/display/raw', async (req, res) => {
  try {
    const deviceId = req.query.device || (config.devices[0] ? config.devices[0].id : 'default_screen');
    const force = req.query.force === 'true';

    const device = getOrCreateDevice(deviceId, req.query);
    recordDeviceConnection(device, req);
    const data = await fetchDeviceDisplayData(device, force);

    const cached = imageCache[deviceId];
    const rate = (cached && cached.refreshRate) ? cached.refreshRate : (device.refreshRate || 1800);
    const sleepInterval = resolveDeepSleepInterval(device);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Refresh-Rate', rate.toString());
    res.setHeader('X-Trmnl-Deep-Sleep', sleepInterval.toString());
    res.send(data.raw);
  } catch (err) {
    console.error(err);
    res.status(500).send("Render engine error");
  }
});

// TRMNL Official BYOS Protocol endpoint (expected by TRMNL firmware)
app.get('/api/display', async (req, res) => {
  try {
    // TRMNL hardware passes Access-Token and ID in headers
    // But since this is a private network, we fall back to auto-registration
    const mac = req.headers['id'] || req.query.device || (config.devices[0] ? config.devices[0].id : 'default_screen');
    const device = getOrCreateDevice(mac, req.query);
    recordDeviceConnection(device, req);
    
    // Trigger render to keep files up to date
    await fetchDeviceDisplayData(device);

    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const serverIp = req.headers.host;
    const imageUrl = `${protocol}://${serverIp}/api/display/image.png?device=${device.id}`;

    const cached = imageCache[device.id];
    const rate = (cached && cached.refreshRate) ? cached.refreshRate : (device.refreshRate || 1800);
    const sleepInterval = resolveDeepSleepInterval(device);

    res.setHeader('X-Trmnl-Deep-Sleep', sleepInterval.toString());

    // Return official TRMNL BYOS response format
    res.json({
      image_url: imageUrl,
      image_name: `screen-${device.id}-${Math.floor(Date.now() / 1000)}.png`,
      update_firmware: false,
      firmware_url: null,
      refresh_rate: rate.toString(),
      reset_firmware: false,
      status: 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 1, error: "Setup failed" });
  }
});

// TRMNL Setup Endpoint (supports both GET and POST for official TRMNL BYOS hardware registration)
app.all('/api/setup', (req, res) => {
  try {
    const mac = req.headers['id'] || req.query.device || (config.devices[0] ? config.devices[0].id : 'default_screen');
    console.log(`[TRMNL Setup] Device ${mac} initiated setup via ${req.method}.`);
    
    // Auto-Register or get existing device in E-Ink configuration
    const device = getOrCreateDevice(mac, req.query);
    recordDeviceConnection(device, req);
    
    // Generate friendly ID from the MAC/Device ID
    const friendlyId = mac.replace(/:/g, '').slice(-6).toUpperCase();
    
    // Construct the immediate setup/rendering image URL
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const serverIp = req.headers.host;
    const imageUrl = `${protocol}://${serverIp}/api/display/image.png?device=${device.id}`;
    
    // Return official TRMNL BYOS registration response format
    res.json({
      status: 200,
      setup: true,
      api_key: device.id,
      friendly_id: friendlyId,
      image_url: imageUrl,
      message: "Welcome to InkFlow E-Ink Server!"
    });
  } catch (err) {
    console.error("[TRMNL Setup] Error in registration handler:", err);
    res.status(500).json({ status: 500, error: "Setup failed" });
  }
});

// TRMNL Log Endpoint
app.post('/api/log', (req, res) => {
  const mac = req.headers['id'] || 'unknown';
  console.log(`[Device Log][${mac}]:`, JSON.stringify(req.body));
  res.json({ status: 0 });
});

// Force manual refresh endpoint (called from control panel)
app.post('/api/display/refresh', async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Device ID required" });

    const device = config.devices.find(d => d.id === deviceId);
    if (!device) return res.status(404).json({ error: "Device not found" });

    const data = await fetchDeviceDisplayData(device, true);
    res.json({ success: true, message: "Screen compiled and dithered successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete device manual trigger
app.post('/api/display/delete', (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Device ID required" });

    if (deviceId === 'default_screen') {
      return res.status(400).json({ error: "The default screen is protected and cannot be deleted" });
    }

    const idx = config.devices.findIndex(d => d.id === deviceId);
    if (idx === -1) return res.status(404).json({ error: "Device not found" });

    config.devices.splice(idx, 1);
    delete imageCache[deviceId];
    saveConfig();
    console.log(`[Device Management] Deleted device: ${deviceId}`);
    res.json({ success: true, message: `Device '${deviceId}' deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Automatically prunes devices that have not been seen for a configured threshold of days
 */
const cleanupStaleDevices = () => {
  try {
    const cleanupSettings = (config.settings && config.settings.deviceCleanup) || { enabled: false, maxOfflineDays: 7 };
    if (!cleanupSettings.enabled) return;

    const maxDays = parseInt(cleanupSettings.maxOfflineDays) || 7;
    const thresholdMs = maxDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    const initialCount = config.devices.length;
    
    // Filter out devices where lastSeen is older than threshold
    // Keep 'default_screen' as a safety safeguard!
    config.devices = config.devices.filter(device => {
      if (device.id === 'default_screen') return true;
      if (!device.lastSeen) return true; // keep if never seen yet
      
      const lastSeenMs = new Date(device.lastSeen).getTime();
      const offlineDuration = now - lastSeenMs;
      
      const shouldKeep = offlineDuration < thresholdMs;
      if (!shouldKeep) {
        delete imageCache[device.id];
        console.log(`[Auto-Cleanup] Pruned stale device: ${device.id} (Offline for ${Math.round(offlineDuration / (3600 * 1000 * 24))} days)`);
      }
      return shouldKeep;
    });

    if (config.devices.length !== initialCount) {
      saveConfig();
    }
  } catch (err) {
    console.error("[Auto-Cleanup] Error pruning stale devices:", err);
  }
};

// Run stale device cleanup checks on startup
cleanupStaleDevices();

// Run stale device cleanup checks every 12 hours
setInterval(cleanupStaleDevices, 12 * 60 * 60 * 1000);

// Start Server
app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`   🚀 InkFlow E-Ink Server Running! 🚀`);
  console.log(`   Local Address: http://localhost:${PORT}`);
  console.log(`   Host Network:  http://${HOST}:${PORT}`);
  console.log(`====================================================`);
});
