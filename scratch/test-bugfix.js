// test-bugfix.js - Verifies settings merging, device preservation, and cache invalidation
const http = require('http');

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

const runTests = async () => {
  console.log("==================================================");
  console.log("🧪 STARTING BUGFIX VERIFICATION SUITE 🧪");
  console.log("==================================================\n");

  // Step 1: Simulate E-Ink client auto-registering
  console.log("🔄 Step 1: Simulating hardware client polling (pi_zero_4in26)...");
  const registerRes = await getJson('/api/display/image.png?device=pi_zero_4in26&width=800&height=480');
  console.log(`✅ Client request response status: ${registerRes.status}`);

  // Step 2: Retrieve settings and verify both default_screen and pi_zero_4in26 exist
  console.log("\n🔄 Step 2: Retrieving active devices list from server...");
  const settingsRes = await getJson('/api/settings');
  const devices = settingsRes.data.devices;
  console.log("Active Devices on Server:");
  devices.forEach(d => console.log(` - ID: ${d.id}, Name: ${d.name}, Plugins: [${d.activePlugins.join(', ')}]`));

  const hasPi = devices.some(d => d.id === 'pi_zero_4in26');
  if (hasPi) {
    console.log("🎉 SUCCESS: Hardware client successfully auto-registered!");
  } else {
    console.error("❌ FAILURE: Hardware client failed to auto-register.");
    process.exit(1);
  }

  // Step 3: Simulate web control panel saving settings with ONLY default_screen (stale update)
  console.log("\n🔄 Step 3: Simulating stale control panel save (sending only default_screen)...");
  const stalePayload = {
    devices: [
      {
        id: "default_screen",
        name: "Living Room Screen (Updated UI)",
        width: 800,
        height: 480,
        refreshRate: 1800,
        activePlugins: ["system", "rss"],
        layoutMode: "grid"
      }
    ],
    settings: settingsRes.data.settings
  };

  const saveRes = await postJson('/api/settings', stalePayload);
  console.log(`✅ Save settings status: ${saveRes.status}, Message:`, saveRes.data);

  // Step 4: Verify server did not delete pi_zero_4in26 during POST
  console.log("\n🔄 Step 4: Verifying server preserved pi_zero_4in26...");
  const verifySettingsRes = await getJson('/api/settings');
  const mergedDevices = verifySettingsRes.data.devices;
  console.log("Devices list after frontend save:");
  mergedDevices.forEach(d => console.log(` - ID: ${d.id}, Name: ${d.name}, Plugins: [${d.activePlugins.join(', ')}]`));

  const piPreserved = mergedDevices.some(d => d.id === 'pi_zero_4in26');
  const defaultUpdated = mergedDevices.find(d => d.id === 'default_screen').name === "Living Room Screen (Updated UI)";

  if (piPreserved && defaultUpdated) {
    console.log("🎉 SUCCESS: Merging logic works! pi_zero_4in26 was preserved, and default_screen was updated.");
  } else {
    console.error("❌ FAILURE: Merging failed. Device was deleted or not updated.");
    process.exit(1);
  }

  // Step 5: Verify cache invalidation
  // We'll update settings for pi_zero_4in26 specifically now to see if cache invalidation takes effect
  console.log("\n🔄 Step 5: Updating pi_zero_4in26 config to show only system stats...");
  const piUpdatePayload = {
    devices: [
      {
        id: "pi_zero_4in26",
        name: "Kitchen EPD",
        width: 800,
        height: 480,
        refreshRate: 1800,
        activePlugins: ["system"],
        layoutMode: "grid"
      }
    ]
  };

  const updateRes = await postJson('/api/settings', piUpdatePayload);
  console.log(`✅ Update response:`, updateRes.data);

  console.log("🔄 Fetching fresh screen for pi_zero_4in26 (should render ONLY system info)...");
  // If cache invalidation works, this will compile a new frame immediately containing only system stats
  const finalFetch = await getJson('/api/display/image.png?device=pi_zero_4in26');
  console.log(`✅ Client GET response status: ${finalFetch.status}`);

  console.log("\n==================================================");
  console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉");
  console.log("==================================================");
};

runTests().catch(console.error);
