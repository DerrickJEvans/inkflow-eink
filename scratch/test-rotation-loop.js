// scratch/test-rotation-loop.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

const getJson = (path) => {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    }).on('error', reject);
  });
};

const postJson = (path, payload) => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const run = async () => {
  console.log("==================================================");
  console.log("🔄 SIMULATING CAROUSEL ROTATION LOOP 🔄");
  console.log("==================================================\n");

  // Step 1: Update settings to configure default_screen in rotation mode
  console.log("Step 1: Configuring default_screen with rotation layout...");
  const configPayload = {
    devices: [
      {
        id: "default_screen",
        name: "Living Room Screen",
        width: 800,
        height: 480,
        refreshRate: 30, // 30 seconds refresh
        activePlugins: ["tfl", "weather", "rss", "rss_tech", "rss_uk", "rss_world"],
        layoutMode: "rotation",
        rotationIntervals: {
          tfl: 30,
          weather: 30,
          rss: 30,
          rss_tech: 30,
          rss_uk: 30,
          rss_world: 30
        }
      }
    ]
  };
  
  const saveRes = await postJson('/api/settings', configPayload);
  console.log("Save Settings Status:", saveRes.data);

  // Step 2: Simulate 7 sequential refreshes
  for (let i = 1; i <= 7; i++) {
    console.log(`\n--- Request #${i} (force=true) ---`);
    
    // We fetch settings first to see the current index
    const settingsBefore = await getJson('/api/settings');
    const deviceBefore = settingsBefore.data.devices.find(d => d.id === 'default_screen');
    console.log(`Current Index BEFORE fetch: ${deviceBefore.currentPluginIndex || 0}`);
    const activePlugin = deviceBefore.activePlugins[(deviceBefore.currentPluginIndex || 0) % deviceBefore.activePlugins.length];
    console.log(`Expected Plugin to Render: ${activePlugin}`);

    // Call display PNG with force=true
    const imgFetch = await getJson('/api/display/image.png?device=default_screen&force=true');
    console.log(`Image GET response: ${imgFetch.status}`);

    const settingsAfter = await getJson('/api/settings');
    const deviceAfter = settingsAfter.data.devices.find(d => d.id === 'default_screen');
    console.log(`Index AFTER fetch (advanced): ${deviceAfter.currentPluginIndex}`);
  }

  console.log("\n==================================================");
  console.log("🎉 ROTATION LOOP TEST COMPLETED 🎉");
  console.log("==================================================");
};

run().catch(console.error);
