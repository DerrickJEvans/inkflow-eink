// server.js - Main Express Server and API Endpoints
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { renderDeviceImage, PLUGINS } = require('./renderer');

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

// Memory cache for compiled screen data
const imageCache = {};

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
  const cacheKey = device.id;
  const now = Date.now();
  const cached = imageCache[cacheKey];
  
  // Resolve dynamic refresh rate for rotation mode
  let refreshRate = device.refreshRate || 1800;
  if (device.layoutMode === 'rotation' && device.activePlugins && device.activePlugins.length > 0) {
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

    // If in rotation mode and we successfully rendered a fresh frame,
    // advance the plugin index for the NEXT poll request!
    if (device.layoutMode === 'rotation' && device.activePlugins && device.activePlugins.length > 1) {
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

// ==========================================
//              API ENDPOINTS
// ==========================================

// Get host Raspberry Pi system metrics
app.get('/api/system-stats', async (req, res) => {
  try {
    const stats = await PLUGINS.system.fetchData({});
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Failed to gather system statistics" });
  }
});

// Get global settings and devices
app.get('/api/settings', (req, res) => {
  res.json(config);
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
    const data = await fetchDeviceDisplayData(device, force);
    
    const cached = imageCache[deviceId];
    const rate = (cached && cached.refreshRate) ? cached.refreshRate : (device.refreshRate || 1800);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Refresh-Rate', rate.toString());
    res.send(data.png);
  } catch (err) {
    console.error(err);
    res.status(500).send("Render engine error");
  }
});

// Direct RAW 1-bit monochrome byte stream URL (for ESP32 client)
app.get('/api/display/raw', async (req, res) => {
  try {
    const deviceId = req.query.device || (config.devices[0] ? config.devices[0].id : 'default_screen');
    const force = req.query.force === 'true';

    const device = getOrCreateDevice(deviceId, req.query);
    const data = await fetchDeviceDisplayData(device, force);

    const cached = imageCache[deviceId];
    const rate = (cached && cached.refreshRate) ? cached.refreshRate : (device.refreshRate || 1800);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Refresh-Rate', rate.toString());
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
    
    // Trigger render to keep files up to date
    await fetchDeviceDisplayData(device);

    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const serverIp = req.headers.host;
    const imageUrl = `${protocol}://${serverIp}/api/display/image.png?device=${device.id}`;

    const cached = imageCache[device.id];
    const rate = (cached && cached.refreshRate) ? cached.refreshRate : (device.refreshRate || 1800);

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

// TRMNL Setup Endpoint
app.post('/api/setup', (req, res) => {
  const mac = req.headers['id'] || 'default_screen';
  console.log(`[TRMNL Setup] Device ${mac} initiated setup.`);
  res.json({ status: 0, setup: true });
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

// Start Server
app.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(`   🚀 TRMNL Pi E-Ink Server Running! 🚀`);
  console.log(`   Local Address: http://localhost:${PORT}`);
  console.log(`   Host Network:  http://${HOST}:${PORT}`);
  console.log(`====================================================`);
});
