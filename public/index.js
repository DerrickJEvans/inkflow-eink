// index.js - Control Center Frontend Logic
let serverConfig = { devices: [], settings: {} };
let activeDeviceId = null;
let hostIpAddress = window.location.hostname || '192.168.1.100';
let hostPort = window.location.port || '5000';

// DOM Elements
const devicesList = document.getElementById('devices-list');
const deviceLayoutCard = document.getElementById('device-layout-card');
const editDeviceForm = document.getElementById('device-settings-form');
const mockupScreen = document.getElementById('mockup-screen');
const mockupRes = document.getElementById('mockup-resolution');
const mockupViewport = document.getElementById('mockup-viewport');
const btnForceRefresh = document.getElementById('btn-force-refresh');
const btnViewPng = document.getElementById('btn-view-raw-png');
const btnViewRaw = document.getElementById('btn-view-raw-bit');

// Connection guide codes
const codeArduino = document.getElementById('code-arduino-url');
const codePi = document.getElementById('code-pi-url');
const codeTrmnl = document.getElementById('code-trmnl-url');
const activeDevicesCount = document.getElementById('active-devices-count');

// Telemetry Elements
const cpuChart = document.getElementById('telemetry-cpu-chart');
const cpuText = document.getElementById('telemetry-cpu-text');
const telemetryTemp = document.getElementById('telemetry-temp');
const telemetryRam = document.getElementById('telemetry-ram');
const telemetryUptime = document.getElementById('telemetry-uptime');

// Global Option Elements
const weatherLat = document.getElementById('weather-lat');
const weatherLon = document.getElementById('weather-lon');
const weatherUnit = document.getElementById('weather-unit');
const rssUrl = document.getElementById('rss-url');
const rssLimit = document.getElementById('rss-limit');
const todoTitle = document.getElementById('todo-title');
const todoEditorList = document.getElementById('todo-editor-list');
const todoAddInput = document.getElementById('todo-add-input');
const btnTodoAdd = document.getElementById('btn-todo-add');
const tflModes = document.getElementById('tfl-modes');
const btnSaveGlobal = document.getElementById('btn-save-global-settings');

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupAccordion();
  setupTodoHandlers();
  
  await fetchSettings();
  startTelemetryLoop();
  
  // Layout Mode Change Handler to toggle rotation settings visibility
  const layoutModeSelect = document.getElementById('edit-device-layout-mode');
  const rotationIntervalsContainer = document.getElementById('rotation-intervals-container');
  if (layoutModeSelect && rotationIntervalsContainer) {
    layoutModeSelect.addEventListener('change', () => {
      if (layoutModeSelect.value === 'rotation') {
        rotationIntervalsContainer.style.display = 'block';
      } else {
        rotationIntervalsContainer.style.display = 'none';
      }
    });
  }

  // Connect default add device trigger
  document.getElementById('btn-add-device').addEventListener('click', () => {
    const id = prompt("Enter a unique Device ID (e.g. kitchen_display, paper_sign):");
    if (id) {
      const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      if (cleanId) {
        selectDevice(cleanId, true); // Create or select
      }
    }
  });

  // Device Layout Settings Form Submit
  editDeviceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-device-id').value;
    const name = document.getElementById('edit-device-name').value;
    const width = parseInt(document.getElementById('edit-device-width').value);
    const height = parseInt(document.getElementById('edit-device-height').value);
    const refreshRate = parseInt(document.getElementById('edit-device-refresh').value);
    const layoutMode = document.getElementById('edit-device-layout-mode').value;
    
    // Read selected plugins
    const activePlugins = [];
    document.querySelectorAll('#plugins-selector input[type="checkbox"]').forEach(cb => {
      if (cb.checked) activePlugins.push(cb.value);
    });

    if (activePlugins.length === 0) {
      alert("Please select at least 1 widget!");
      return;
    }

    // Read rotation intervals
    const rotationIntervals = {
      weather: parseInt(document.getElementById('edit-device-interval-weather').value) || 30,
      system: parseInt(document.getElementById('edit-device-interval-system').value) || 15,
      rss: parseInt(document.getElementById('edit-device-interval-rss').value) || 30,
      notes: parseInt(document.getElementById('edit-device-interval-notes').value) || 15,
      tfl: parseInt(document.getElementById('edit-device-interval-tfl').value) || 30
    };

    // Update locally
    const devIdx = serverConfig.devices.findIndex(d => d.id === id);
    const deviceData = { 
      id, 
      name, 
      width, 
      height, 
      refreshRate, 
      activePlugins, 
      layoutMode, 
      rotationIntervals 
    };
    
    if (devIdx > -1) {
      serverConfig.devices[devIdx] = deviceData;
    } else {
      serverConfig.devices.push(deviceData);
    }

    await saveSettings();
    await triggerManualRefresh(id);
  });

  // Force Refresh Trigger
  btnForceRefresh.addEventListener('click', async () => {
    if (!activeDeviceId) return;
    btnForceRefresh.disabled = true;
    btnForceRefresh.innerText = "⚡ Rendering...";
    try {
      await triggerManualRefresh(activeDeviceId);
    } finally {
      btnForceRefresh.disabled = false;
      btnForceRefresh.innerText = "🔄 Force Refresh";
    }
  });

  // Global Settings save trigger
  btnSaveGlobal.addEventListener('click', async () => {
    // Weather
    serverConfig.settings.weather = {
      latitude: parseFloat(weatherLat.value) || 51.5074,
      longitude: parseFloat(weatherLon.value) || -0.1278,
      unit: weatherUnit.value
    };

    // RSS
    serverConfig.settings.rss = {
      url: rssUrl.value || "https://news.ycombinator.com/rss",
      limit: parseInt(rssLimit.value) || 4
    };

    // Notice Board (title has input, list holds live checklist items)
    serverConfig.settings.notes = {
      title: todoTitle.value || "Notice Board",
      items: getTodoListItems()
    };

    // TfL Rail Settings
    serverConfig.settings.tfl = {
      modes: tflModes.value || "tube,overground,dlr,elizabeth-line"
    };

    await saveSettings();
    if (activeDeviceId) {
      await triggerManualRefresh(activeDeviceId);
    }
  });
});

// Fetch configs from Express server
async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    serverConfig = await res.json();
    
    renderDevicesList();
    renderGlobalSettings();
    
    if (serverConfig.devices.length > 0 && !activeDeviceId) {
      selectDevice(serverConfig.devices[0].id);
    }
  } catch (err) {
    console.error("Error loading server settings:", err);
  }
}

// Save config to Express server
async function saveSettings() {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverConfig)
    });
    const reply = await res.json();
    if (reply.success) {
      showToast("Configuration saved successfully!");
    }
  } catch (err) {
    console.error("Failed saving settings:", err);
    showToast("Error saving configurations!", true);
  }
}

// Trigger screen compile
async function triggerManualRefresh(deviceId) {
  try {
    const res = await fetch('/api/display/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
    const reply = await res.json();
    if (reply.success) {
      updateScreenMockup(deviceId);
      showToast("E-Paper screen rendered & cached!");
    }
  } catch (err) {
    console.error("Failed compiling screen:", err);
    showToast("Render error encountered!", true);
  }
}

// Renders Devices list in Column 1
function renderDevicesList() {
  devicesList.innerHTML = '';
  activeDevicesCount.innerText = `${serverConfig.devices.length} Active`;
  
  if (serverConfig.devices.length === 0) {
    devicesList.innerHTML = `<p class="card-help text-center">No devices configured. They register automatically upon connection.</p>`;
    return;
  }

  serverConfig.devices.forEach(dev => {
    const item = document.createElement('div');
    item.className = `device-item ${dev.id === activeDeviceId ? 'active' : ''}`;
    item.innerHTML = `
      <div class="device-info">
        <span class="name">${dev.name}</span>
        <span class="meta">${dev.width}x${dev.height}px • Interval: ${dev.refreshRate}s</span>
      </div>
      <span class="device-badge">${dev.id}</span>
    `;
    
    item.addEventListener('click', () => selectDevice(dev.id));
    devicesList.appendChild(item);
  });
}

// Select active device
function selectDevice(deviceId, isNew = false) {
  activeDeviceId = deviceId;
  
  // Highlight active
  document.querySelectorAll('.device-item').forEach(el => {
    const badge = el.querySelector('.device-badge').innerText;
    if (badge.toLowerCase() === deviceId.toLowerCase()) el.classList.add('active');
    else el.classList.remove('active');
  });

  let device = serverConfig.devices.find(d => d.id === deviceId);
  
  if (!device && isNew) {
    // Create new temporary device (not saved until form submit)
    device = {
      id: deviceId,
      name: `Screen ${deviceId.toUpperCase()}`,
      width: 800,
      height: 480,
      refreshRate: 1800,
      activePlugins: ["system", "weather", "rss", "notes", "tfl"],
      layoutMode: "grid",
      rotationIntervals: {
        weather: 30,
        system: 15,
        rss: 30,
        notes: 15,
        tfl: 30
      }
    };
  }

  if (device) {
    // Load device parameters into form
    deviceLayoutCard.style.display = 'block';
    document.getElementById('edit-device-id').value = device.id;
    document.getElementById('edit-device-name').value = device.name;
    document.getElementById('edit-device-width').value = device.width;
    document.getElementById('edit-device-height').value = device.height;
    document.getElementById('edit-device-refresh').value = device.refreshRate;

    // Load layout mode and toggle container visibility
    const layoutMode = device.layoutMode || 'grid';
    document.getElementById('edit-device-layout-mode').value = layoutMode;
    
    const intervalsContainer = document.getElementById('rotation-intervals-container');
    if (intervalsContainer) {
      intervalsContainer.style.display = layoutMode === 'rotation' ? 'block' : 'none';
    }

    // Load rotation intervals
    const rotationIntervals = device.rotationIntervals || {};
    document.getElementById('edit-device-interval-weather').value = rotationIntervals.weather || '';
    document.getElementById('edit-device-interval-system').value = rotationIntervals.system || '';
    document.getElementById('edit-device-interval-rss').value = rotationIntervals.rss || '';
    document.getElementById('edit-device-interval-notes').value = rotationIntervals.notes || '';
    document.getElementById('edit-device-interval-tfl').value = rotationIntervals.tfl || '';

    // Checkboxes
    document.querySelectorAll('#plugins-selector input[type="checkbox"]').forEach(cb => {
      cb.checked = device.activePlugins.includes(cb.value);
    });

    updateScreenMockup(device.id);
    updateGuides(device);
  }
}

// Updates physical bezel screen frame
function updateScreenMockup(deviceId) {
  const device = serverConfig.devices.find(d => d.id === deviceId);
  if (!device) return;

  mockupRes.innerText = `${device.width} x ${device.height}`;
  
  // Aspect ratio adjustment dynamically
  mockupViewport.style.aspectRatio = `${device.width} / ${device.height}`;
  
  // Set backgrounds dithered png
  const imgUrl = `/api/display/image.png?device=${device.id}&t=${Date.now()}`;
  mockupScreen.innerHTML = '';
  mockupScreen.style.backgroundImage = `url('${imgUrl}')`;

  // Links
  btnViewPng.href = imgUrl;
  btnViewRaw.href = `/api/display/raw?device=${device.id}&width=${device.width}&height=${device.height}`;
}

// Guides dynamic URLs updates
function updateGuides(device) {
  const protocol = window.location.protocol;
  const ipHost = `${hostIpAddress}:${hostPort}`;
  
  codeArduino.innerHTML = `${protocol}//${ipHost}/api/display/raw?device=${device.id}&amp;width=${device.width}&amp;height=${device.height}`;
  codePi.innerHTML = `${protocol}//${ipHost}/api/display/image.png?device=${device.id}&amp;width=${device.width}&amp;height=${device.height}`;
  codeTrmnl.innerHTML = `${protocol}//${ipHost}`;
}

// Renders Global Plugin Options
function renderGlobalSettings() {
  const settings = serverConfig.settings || {};

  // Weather
  const weather = settings.weather || { latitude: 51.5074, longitude: -0.1278, unit: 'celsius' };
  weatherLat.value = weather.latitude;
  weatherLon.value = weather.longitude;
  weatherUnit.value = weather.unit;

  // RSS
  const rss = settings.rss || { url: 'https://news.ycombinator.com/rss', limit: 4 };
  rssUrl.value = rss.url;
  rssLimit.value = rss.limit;

  // Todo board
  const notes = settings.notes || { title: 'Family Notice Board', items: [] };
  todoTitle.value = notes.title;

  // TfL Rail
  const tfl = settings.tfl || { modes: 'tube,overground,dlr,elizabeth-line' };
  tflModes.value = tfl.modes;

  renderTodoList(notes.items);
}

// Render Todo items inside checklist editor
function renderTodoList(items) {
  todoEditorList.innerHTML = '';
  if (!items || items.length === 0) {
    todoEditorList.innerHTML = `<span class="text-sm text-center" style="display:block;padding:10px;">Notice checklist is empty.</span>`;
    return;
  }

  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'todo-editor-item';
    
    let isCompleted = false;
    let text = item;
    
    if (text.startsWith('[x]') || text.startsWith('[X]')) {
      isCompleted = true;
      text = text.substring(3).trim();
      row.classList.add('completed');
    } else if (text.startsWith('[ ]')) {
      text = text.substring(3).trim();
    }

    row.innerHTML = `
      <input type="checkbox" class="todo-check" ${isCompleted ? 'checked' : ''}>
      <span>${text}</span>
      <button class="btn-todo-del" title="Delete">×</button>
    `;

    // Toggle completed state
    row.querySelector('.todo-check').addEventListener('change', (e) => {
      if (e.target.checked) row.classList.add('completed');
      else row.classList.remove('completed');
    });

    // Delete item
    row.querySelector('.btn-todo-del').addEventListener('click', () => {
      row.remove();
    });

    todoEditorList.appendChild(row);
  });
}

// Collect items from Checklist Editor
function getTodoListItems() {
  const items = [];
  document.querySelectorAll('.todo-editor-item').forEach(row => {
    const isCompleted = row.querySelector('.todo-check').checked;
    const text = row.querySelector('span').innerText;
    items.push(`${isCompleted ? '[x]' : '[ ]'} ${text}`);
  });
  return items;
}

// Checklist custom add handlers
function setupTodoHandlers() {
  const addTodo = () => {
    const text = todoAddInput.value.trim();
    if (!text) return;

    const row = document.createElement('div');
    row.className = 'todo-editor-item';
    row.innerHTML = `
      <input type="checkbox" class="todo-check">
      <span>${text}</span>
      <button class="btn-todo-del">×</button>
    `;

    row.querySelector('.todo-check').addEventListener('change', (e) => {
      if (e.target.checked) row.classList.add('completed');
      else row.classList.remove('completed');
    });

    row.querySelector('.btn-todo-del').addEventListener('click', () => row.remove());

    // remove placeholder if present
    const emptySpan = todoEditorList.querySelector('span[style*="display:block"]');
    if (emptySpan) emptySpan.remove();

    todoEditorList.appendChild(row);
    todoAddInput.value = '';
    todoAddInput.focus();
  };

  btnTodoAdd.addEventListener('click', addTodo);
  todoAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTodo();
  });
}

// Tabs UI handler
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

// Accordion Options handler
function setupAccordion() {
  document.querySelectorAll('.accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const targetId = trigger.dataset.target;
      const target = document.getElementById(targetId);
      const isOpen = target.classList.contains('active');

      document.querySelectorAll('.accordion-content').forEach(c => c.classList.remove('active'));
      
      if (!isOpen) {
        target.classList.add('active');
      }
    });
  });
}

// Toast indicator animation
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.style.background = isError ? 'rgba(255, 23, 68, 0.95)' : 'rgba(0, 230, 118, 0.95)';
  toast.style.color = isError ? '#ffffff' : '#020604';
  
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Host Pi Metrics fetching loop
async function startTelemetryLoop() {
  const updateStats = async () => {
    try {
      const res = await fetch('/api/system-stats');
      if (!res.ok) return;
      const data = await res.json();
      
      // Update circular load gauge
      const val = Math.min(100, Math.max(0, data.cpuUsage || 0));
      cpuText.innerText = `${val}%`;
      cpuChart.setAttribute('stroke-dasharray', `${val}, 100`);
      
      // Update metadata text
      telemetryTemp.innerText = `${data.cpuTemp}°C`;
      telemetryRam.innerText = data.ramText || '--';
      telemetryUptime.innerText = data.uptime || '--';
    } catch (e) {
      console.warn("Telemetry offline (disconnected from live Pi telemetry)");
    }
  };
  
  await updateStats();
  setInterval(updateStats, 3000);
}
