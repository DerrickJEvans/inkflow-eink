// index.js - Control Center Frontend Logic
let serverConfig = { devices: [], settings: {} };
let activeDeviceId = null;
let hostIpAddress = window.location.hostname || '192.168.1.100';
let hostPort = window.location.port || '5000';
let availablePlugins = []; // Holds all dynamic/AI plugins
const pluginIcons = {
  weather: '🌤️',
  system: '⚡',
  rss: '📰',
  notes: '📌',
  tfl: '🚇',
  uk_trains: '🚊',
  xkcd: '🖼️',
  world_clock: '🌍',
  ai_briefing: '🗞️',
  ai_advisor: '🛠️',
  airport_board: '✈️',
  tide_timetable: '🌊',
  lunar_calendar: '🌙'
};

// DOM Elements
const devicesList = document.getElementById('devices-list');
const deviceLayoutCard = document.getElementById('device-layout-card');
const editDeviceForm = document.getElementById('device-settings-form');
const mockupScreen = document.getElementById('mockup-screen');
const mockupRes = document.getElementById('mockup-resolution');
const mockupViewport = document.getElementById('mockup-viewport');
const btnForceRefresh = document.getElementById('btn-force-refresh');
const btnFlushCache = document.getElementById('btn-flush-cache');
const btnViewPng = document.getElementById('btn-view-raw-png');
const btnViewRaw = document.getElementById('btn-view-raw-bit');

// Bezel Mockup Tabs Navigation DOM references and state tracking
const mockupTabsContainer = document.getElementById('mockup-tabs-container');
const mockupTabs = document.getElementById('mockup-tabs');
const btnMockupPrev = document.getElementById('btn-mockup-prev');
const btnMockupNext = document.getElementById('btn-mockup-next');

let mockupPreviewMode = 'live'; // 'live' or 'preview'
let mockupPreviewPluginId = null; // Currently active plugin ID in preview mode
let mockupActivePluginIndex = 0; // Current active pill index (0 = Live Screen, 1+ = active plugins)

// Dedicated AI Previewer & Hosted Widget Elements
const aiMockupScreen = document.getElementById('ai-mockup-screen');
const aiMockupRes = document.getElementById('ai-mockup-resolution');
const aiMockupViewport = document.getElementById('ai-mockup-viewport');
const btnAiPreviewRefresh = document.getElementById('btn-ai-preview-refresh');
const btnAiViewPng = document.getElementById('btn-ai-view-png');
const widgetSearch = document.getElementById('widget-search');
const hostedWidgetsGrid = document.getElementById('hosted-widgets-grid');
let activePreviewPluginId = 'weather';

// Connection guide codes
const codeArduino = document.getElementById('code-arduino-url');
const codePi = document.getElementById('code-pi-url');
const codeTrmnl = document.getElementById('code-trmnl-url');
const activeDevicesCount = document.getElementById('active-devices-count');

// AI Widget Generator Elements
const aiPromptInput = document.getElementById('ai-prompt-input');
const btnBuildWidget = document.getElementById('btn-build-widget');
const aiLoadingContainer = document.getElementById('ai-loading-container');
const aiLoadingText = document.getElementById('ai-loading-text');

// Telemetry Elements
const cpuChart = document.getElementById('telemetry-cpu-chart');
const cpuText = document.getElementById('telemetry-cpu-text');
const telemetryTemp = document.getElementById('telemetry-temp');
const telemetryRam = document.getElementById('telemetry-ram');
const telemetryUptime = document.getElementById('telemetry-uptime');
const telemetryGraph = document.getElementById('telemetry-graph');

const telemetryHistory = [];
const maxTelemetryPoints = 40; // ~2 minutes of history
let uptimeSeconds = 0;
let uptimeInterval = null;



// Initialize Dashboard
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupMainTabs();
  setupAiAdminTabListeners();

  // Widget Search catalog filter listener
  if (widgetSearch) {
    widgetSearch.addEventListener('input', (e) => {
      renderHostedWidgetsList(e.target.value);
    });
  }

  // Dedicated AI Preview Refresh button
  if (btnAiPreviewRefresh) {
    btnAiPreviewRefresh.addEventListener('click', () => {
      btnAiPreviewRefresh.disabled = true;
      btnAiPreviewRefresh.innerText = "⚡ Rendering...";
      try {
        updateAiPreviewMockup(activePreviewPluginId);
      } finally {
        setTimeout(() => {
          btnAiPreviewRefresh.disabled = false;
          btnAiPreviewRefresh.innerText = "🔄 Refresh Preview";
        }, 800);
      }
    });
  }


  
  await fetchSettings();
  startTelemetryLoop();
  startDeviceListSync();
  


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

  // Initialize Auto-Cleanup Settings Listeners
  const cleanupEnabled = document.getElementById('cleanup-enabled');
  const cleanupDays = document.getElementById('cleanup-days');
  const cleanupDetails = document.getElementById('cleanup-details');

  if (cleanupEnabled && cleanupDays && cleanupDetails) {
    const handleCleanupChange = async () => {
      if (!serverConfig.settings) serverConfig.settings = {};
      serverConfig.settings.deviceCleanup = {
        enabled: cleanupEnabled.checked,
        maxOfflineDays: parseInt(cleanupDays.value) || 7
      };
      cleanupDetails.style.display = cleanupEnabled.checked ? 'flex' : 'none';
      await saveSettings();
    };

    cleanupEnabled.addEventListener('change', handleCleanupChange);
    cleanupDays.addEventListener('change', handleCleanupChange);
  }

  // Device Layout Settings Form Submit
  editDeviceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-device-id').value;
    const name = document.getElementById('edit-device-name').value;
    const width = parseInt(document.getElementById('edit-device-width').value);
    const height = parseInt(document.getElementById('edit-device-height').value);
    const refreshRate = parseInt(document.getElementById('edit-device-refresh').value);
    const layoutMode = "rotation";
    const ditherMode = document.getElementById('edit-device-dither').value;
    const invertColors = document.getElementById('edit-device-invert').value === 'true';
    const sleepPeriodEnabled = document.getElementById('edit-device-sleep-enabled').value === 'true';
    const sleepPeriodStart = document.getElementById('edit-device-sleep-start').value || '22:00';
    const sleepPeriodEnd = document.getElementById('edit-device-sleep-end').value || '07:00';
    const sleepPeriodTimezone = document.getElementById('edit-device-sleep-timezone').value || '';
    const activePlugins = [];
    const rotationIntervals = {};

    document.querySelectorAll('#plugins-selector .widget-card').forEach(card => {
      const pluginId = card.dataset.id;
      if (!pluginId) return;
      const minInput = card.querySelector('input.plugin-duration-min');
      const secInput = card.querySelector('input.plugin-duration-sec');
      const mins = minInput ? (parseInt(minInput.value) || 0) : 0;
      const secs = secInput ? (parseInt(secInput.value) || 0) : 30;
      activePlugins.push(pluginId);
      rotationIntervals[pluginId] = (mins * 60) + secs;
    });

    if (activePlugins.length === 0) {
      alert("Please select at least 1 widget!");
      return;
    }

    // Update locally
    const devIdx = serverConfig.devices.findIndex(d => d.id === id);
    const deviceData = { 
      id, 
      name, 
      width, 
      height, 
      refreshRate, 
      activePlugins, 
      layoutMode: "rotation", 
      ditherMode,
      invertColors,
      rotationIntervals,
      sleepPeriodEnabled,
      sleepPeriodStart,
      sleepPeriodEnd,
      sleepPeriodTimezone
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

  // Flush Cache Trigger
  btnFlushCache.addEventListener('click', async () => {
    if (!activeDeviceId) return;
    btnFlushCache.disabled = true;
    btnFlushCache.innerText = "🧹 Flushing...";
    try {
      const res = await fetch('/api/display/flush-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: activeDeviceId })
      });
      const reply = await res.json();
      if (reply.success) {
        showToast("Client cache flushed! Device will update on next sync.");
      }
    } catch (err) {
      console.error("Failed to flush device cache:", err);
      showToast("Flush cache error!", true);
    } finally {
      btnFlushCache.disabled = false;
      btnFlushCache.innerText = "🧹 Flush Cache";
    }
  });

  // Bezel Mockup prev/next arrow click navigators
  if (btnMockupPrev) {
    btnMockupPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!activeDeviceId) return;
      const device = serverConfig.devices.find(d => d.id === activeDeviceId);
      if (!device) return;
      
      const activePlugins = (device.activePlugins || []).filter(pId => availablePlugins.some(ap => ap.id === pId));
      const totalTabs = activePlugins.length + 1;
      if (totalTabs <= 1) return;
      
      mockupActivePluginIndex = (mockupActivePluginIndex - 1 + totalTabs) % totalTabs;
      triggerMockupTabClick(mockupActivePluginIndex);
    });
  }

  if (btnMockupNext) {
    btnMockupNext.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!activeDeviceId) return;
      const device = serverConfig.devices.find(d => d.id === activeDeviceId);
      if (!device) return;
      
      const activePlugins = (device.activePlugins || []).filter(pId => availablePlugins.some(ap => ap.id === pId));
      const totalTabs = activePlugins.length + 1;
      if (totalTabs <= 1) return;
      
      mockupActivePluginIndex = (mockupActivePluginIndex + 1) % totalTabs;
      triggerMockupTabClick(mockupActivePluginIndex);
    });
  }

  function triggerMockupTabClick(index) {
    if (!mockupTabs) return;
    const pills = mockupTabs.querySelectorAll('.mockup-tab-pill');
    if (pills && pills[index]) {
      pills[index].click();
    }
  }





  // AI Widget Generator Click Handler
  if (btnBuildWidget) {
    btnBuildWidget.addEventListener('click', async () => {
      const promptText = aiPromptInput.value.trim();
      const engineName = getActiveBuilderName();
      if (!promptText) {
        alert(`Please describe what custom widget you want ${engineName} to build first!`);
        return;
      }

      // Disable inputs and show loading state
      btnBuildWidget.disabled = true;
      aiPromptInput.disabled = true;
      aiLoadingContainer.style.display = 'block';
      aiLoadingText.innerText = `${engineName} is writing clean SVG layout code...`;

      try {
        const response = await fetch('/api/ai/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptText })
        });
        const reply = await response.json();

        if (reply.success) {
          showToast(`Widget built successfully!`);
          aiPromptInput.value = ''; // clear input

          // Re-fetch all plugins and re-render selector checkboxes
          await fetchPlugins();
          
          // Add this new plugin to the active device's selection automatically!
          if (activeDeviceId) {
            const device = serverConfig.devices.find(d => d.id === activeDeviceId);
            if (device) {
              if (!device.activePlugins.includes(reply.pluginId)) {
                device.activePlugins.push(reply.pluginId);
                if (!device.rotationIntervals) device.rotationIntervals = {};
                device.rotationIntervals[reply.pluginId] = 30;
              }
              renderPluginsSelector(device.activePlugins, device.rotationIntervals || {});
              await saveSettings();
              await triggerManualRefresh(activeDeviceId);
            }
          } else {
            renderPluginsSelector([]);
          }
          
          renderHostedWidgetsList();
          updateAiPreviewMockup(reply.pluginId);
        } else {
          showToast(reply.error || "Generation failed!", true);
        }
      } catch (err) {
        console.error("AI Widget creation error:", err);
        showToast("Server error during widget compilation!", true);
      } finally {
        btnBuildWidget.disabled = false;
        aiPromptInput.disabled = false;
        aiLoadingContainer.style.display = 'none';
      }
    });
  }
});

// Helper to determine which AI engine is active for widget building
function getActiveBuilderName() {
  if (serverConfig && serverConfig.aiEngines && serverConfig.aiEngines.widgetBuilder) {
    const provider = serverConfig.aiEngines.widgetBuilder.toLowerCase();
    if (provider === 'gemini') return 'Google Gemini';
    if (provider === 'groq') return 'Groq Llama';
    if (provider === 'ollama') return 'Ollama (Local)';
    if (provider === 'none') return 'Offline Fallback';
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
  return 'Google Gemini';
}

// Update instructions and text based on active AI engine
function updateAiGeneratorHelpText() {
  const engineName = getActiveBuilderName();
  const helpEl = document.getElementById('ai-generator-help-text');
  if (helpEl) {
    helpEl.innerHTML = `Describe any custom widget you want. <strong>${engineName}</strong> will dynamically generate, compile, and register it instantly!`;
  }
  const loadingEl = document.getElementById('ai-loading-text');
  if (loadingEl) {
    loadingEl.innerText = `${engineName} is writing SVG layouts...`;
  }
}

// Fetch available plugins from server
async function fetchPlugins() {
  try {
    const res = await fetch('/api/plugins');
    availablePlugins = await res.json();
  } catch (err) {
    console.error("Failed to fetch available plugins:", err);
    // Offline fallback static list
    availablePlugins = [
      { id: 'weather', name: 'Weather Forecast', description: 'Forecast' },
      { id: 'system', name: 'Host System Health', description: 'System health' },
      { id: 'rss', name: 'RSS Bulletin Feed', description: 'RSS feeds' },
      { id: 'notes', name: 'Notices & Todos', description: 'Checklist board' },
      { id: 'tfl', name: 'TfL Rail Status', description: 'London underground status' },
      { id: 'uk_trains', name: 'UK Train Board', description: 'Live departures' },
      { id: 'xkcd', name: 'XKCD Comics', description: 'Daily comics strip' },
      { id: 'world_clock', name: 'World Clock', description: 'World clock and moon phases' },
      { id: 'ai_briefing', name: 'Daily AI Briefing', description: 'Gemini synthesized editorial bulletin' },
      { id: 'ai_advisor', name: 'AI Telemetry Advisor', description: 'Gemini system performance recommendations' }
    ];
  }
}

// Render dynamic reorderable cards inside a horizontal flex scroll container and available palette
function renderPluginsSelector(selectedPluginIds = [], rotationIntervals = {}) {
  const containerSelector = document.getElementById('plugins-selector');
  const containerPalette = document.getElementById('plugins-palette');
  if (!containerSelector || !containerPalette) return;

  containerSelector.innerHTML = '';
  containerPalette.innerHTML = '';

  // Get active plugins in selected order
  const activePlugins = selectedPluginIds
    .map(pId => availablePlugins.find(p => p.id === pId))
    .filter(Boolean);

  // Get inactive plugins for the palette
  const inactivePlugins = availablePlugins.filter(p => !selectedPluginIds.includes(p.id));

  // 1. Render Active Rotation Sequence
  if (activePlugins.length === 0) {
    containerSelector.innerHTML = `<p class="card-help text-center" style="margin: auto; color: var(--text-secondary);">No active widgets. Click widgets from the palette below to add them!</p>`;
  } else {
    activePlugins.forEach(plugin => {
      const duration = rotationIntervals[plugin.id] || 30; // default to 30s
      
      const card = document.createElement('div');
      card.className = 'widget-card active-selected';
      card.setAttribute('draggable', 'true');
      card.dataset.id = plugin.id;
      card.title = plugin.description || '';

      // Close/Remove Button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'widget-card-remove';
      removeBtn.innerHTML = '✖';
      removeBtn.title = 'Remove from rotation';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove from list and re-render
        const index = selectedPluginIds.indexOf(plugin.id);
        if (index > -1) {
          selectedPluginIds.splice(index, 1);
        }
        renderPluginsSelector(selectedPluginIds, rotationIntervals);
      });
      card.appendChild(removeBtn);

      // Icon and label
      const contentWrap = document.createElement('div');
      contentWrap.style.marginTop = '10px';
      contentWrap.style.pointerEvents = 'none';
      
      const icon = document.createElement('div');
      icon.style.fontSize = '32px';
      icon.style.marginBottom = '6px';
      icon.innerText = pluginIcons[plugin.id] || '🧩';
      
      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.fontSize = '12px';
      title.style.color = '#fff';
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      title.style.maxWidth = '145px';
      title.innerText = plugin.name;
      
      contentWrap.appendChild(icon);
      contentWrap.appendChild(title);
      card.appendChild(contentWrap);

      // Duration spinner (Minutes and Seconds)
      const durationWrap = document.createElement('div');
      durationWrap.className = 'widget-card-duration';
      
      const durationLabel = document.createElement('span');
      durationLabel.innerText = 'Show:';
      
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;

      const minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.className = 'plugin-duration-min';
      minInput.value = minutes;
      minInput.min = '0';
      minInput.style.width = '35px';
      
      const minLabel = document.createElement('span');
      minLabel.innerText = 'm';
      
      const secInput = document.createElement('input');
      secInput.type = 'number';
      secInput.className = 'plugin-duration-sec';
      secInput.value = seconds;
      secInput.min = '0';
      secInput.max = '59';
      secInput.step = '5';
      secInput.style.width = '35px';
      
      const secLabel = document.createElement('span');
      secLabel.innerText = 's';
      
      const updateInterval = () => {
        const mins = parseInt(minInput.value) || 0;
        const secs = parseInt(secInput.value) || 0;
        rotationIntervals[plugin.id] = (mins * 60) + secs;
      };

      minInput.addEventListener('change', updateInterval);
      secInput.addEventListener('change', updateInterval);
      
      durationWrap.appendChild(durationLabel);
      durationWrap.appendChild(minInput);
      durationWrap.appendChild(minLabel);
      durationWrap.appendChild(secInput);
      durationWrap.appendChild(secLabel);
      card.appendChild(durationWrap);

      // Left/Right Reordering buttons
      const reorderWrap = document.createElement('div');
      reorderWrap.className = 'widget-card-reorder';
      
      const btnLeft = document.createElement('button');
      btnLeft.type = 'button';
      btnLeft.className = 'widget-btn-sort';
      btnLeft.innerHTML = '←';
      btnLeft.title = 'Move left';
      btnLeft.addEventListener('click', (e) => {
        e.stopPropagation();
        const prev = card.previousElementSibling;
        if (prev) {
          containerSelector.insertBefore(card, prev);
          // Sync selectedPluginIds array order
          const idx = selectedPluginIds.indexOf(plugin.id);
          if (idx > 0) {
            const temp = selectedPluginIds[idx];
            selectedPluginIds[idx] = selectedPluginIds[idx - 1];
            selectedPluginIds[idx - 1] = temp;
          }
        }
      });
      
      const btnRight = document.createElement('button');
      btnRight.type = 'button';
      btnRight.className = 'widget-btn-sort';
      btnRight.innerHTML = '→';
      btnRight.title = 'Move right';
      btnRight.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = card.nextElementSibling;
        if (next) {
          containerSelector.insertBefore(next, card);
          // Sync selectedPluginIds array order
          const idx = selectedPluginIds.indexOf(plugin.id);
          if (idx > -1 && idx < selectedPluginIds.length - 1) {
            const temp = selectedPluginIds[idx];
            selectedPluginIds[idx] = selectedPluginIds[idx + 1];
            selectedPluginIds[idx + 1] = temp;
          }
        }
      });
      
      reorderWrap.appendChild(btnLeft);
      reorderWrap.appendChild(btnRight);
      card.appendChild(reorderWrap);

      // Prevent event propagation
      minInput.addEventListener('mousedown', (e) => e.stopPropagation());
      secInput.addEventListener('mousedown', (e) => e.stopPropagation());
      btnLeft.addEventListener('mousedown', (e) => e.stopPropagation());
      btnRight.addEventListener('mousedown', (e) => e.stopPropagation());
      removeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

      // Drag & Drop
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', plugin.id);
      });
      
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
      });
      
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingCard = containerSelector.querySelector('.dragging');
        if (!draggingCard || draggingCard === card) return;
        
        const rect = card.getBoundingClientRect();
        const midpoint = rect.left + rect.width / 2;
        
        const oldIndex = selectedPluginIds.indexOf(draggingCard.dataset.id);
        const targetIndex = selectedPluginIds.indexOf(card.dataset.id);

        if (e.clientX < midpoint) {
          containerSelector.insertBefore(draggingCard, card);
          if (oldIndex > -1 && targetIndex > -1) {
            selectedPluginIds.splice(oldIndex, 1);
            const insertIdx = targetIndex > oldIndex ? targetIndex - 1 : targetIndex;
            selectedPluginIds.splice(insertIdx, 0, draggingCard.dataset.id);
          }
        } else {
          containerSelector.insertBefore(draggingCard, card.nextElementSibling);
          if (oldIndex > -1 && targetIndex > -1) {
            selectedPluginIds.splice(oldIndex, 1);
            const insertIdx = targetIndex > oldIndex ? targetIndex : targetIndex + 1;
            selectedPluginIds.splice(insertIdx, 0, draggingCard.dataset.id);
          }
        }
      });

      containerSelector.appendChild(card);
    });
  }

  // 2. Render Inactive Palette
  if (inactivePlugins.length === 0) {
    containerPalette.innerHTML = `<p class="card-help text-center" style="margin: auto; color: var(--text-secondary);">All available widgets are active in rotation!</p>`;
  } else {
    inactivePlugins.forEach(plugin => {
      const card = document.createElement('div');
      card.className = 'widget-card';
      card.dataset.id = plugin.id;
      card.title = plugin.description || '';
      card.style.cursor = 'pointer';

      // Icon and label
      const contentWrap = document.createElement('div');
      contentWrap.style.marginTop = '10px';
      contentWrap.style.pointerEvents = 'none';
      
      const icon = document.createElement('div');
      icon.style.fontSize = '32px';
      icon.style.marginBottom = '6px';
      icon.innerText = pluginIcons[plugin.id] || '🧩';
      
      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.style.fontSize = '12px';
      title.style.color = '#fff';
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      title.style.maxWidth = '145px';
      title.innerText = plugin.name;
      
      contentWrap.appendChild(icon);
      contentWrap.appendChild(title);
      card.appendChild(contentWrap);

      // Add hint/badge style indicator at the bottom
      const addHint = document.createElement('div');
      addHint.style.fontSize = '10px';
      addHint.style.color = 'var(--accent-cyan)';
      addHint.style.marginTop = '8px';
      addHint.style.fontWeight = 'bold';
      addHint.innerText = '➕ Add';
      card.appendChild(addHint);

      // Click to add to sequence
      card.addEventListener('click', () => {
        selectedPluginIds.push(plugin.id);
        renderPluginsSelector(selectedPluginIds, rotationIntervals);
      });

      containerPalette.appendChild(card);
    });
  }
}

// Fetch configs from Express server
async function fetchSettings() {
  try {
    await fetchPlugins();
    const res = await fetch('/api/settings');
    serverConfig = await res.json();
    
    updateAiGeneratorHelpText();
    renderDevicesList();
    renderHostedWidgetsList();
    updateAiPreviewMockup(activePreviewPluginId);
    
    // Populate auto-cleanup UI from server settings
    const cleanupEnabled = document.getElementById('cleanup-enabled');
    const cleanupDays = document.getElementById('cleanup-days');
    const cleanupDetails = document.getElementById('cleanup-details');
    if (cleanupEnabled && cleanupDays && cleanupDetails) {
      const settings = (serverConfig.settings && serverConfig.settings.deviceCleanup) || { enabled: false, maxOfflineDays: 7 };
      cleanupEnabled.checked = settings.enabled;
      cleanupDays.value = settings.maxOfflineDays || 7;
      cleanupDetails.style.display = settings.enabled ? 'flex' : 'none';
    }
    
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

// Helper to format ISO timestamps into elegant human-readable relative strings
function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  try {
    const past = new Date(isoStr);
    const now = new Date();
    const diffMs = now - past;
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return 'yesterday';
    return `${diffDays}d ago`;
  } catch (e) {
    return '';
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
    
    let metaText = `${dev.width}x${dev.height}px • Interval: ${dev.refreshRate}s`;
    if (dev.lastIp) {
      const hostDisplay = dev.lastHostname ? dev.lastHostname : dev.lastIp;
      metaText += ` • Seen: ${hostDisplay}`;
      if (dev.lastSeen) {
        metaText += ` (${formatRelativeTime(dev.lastSeen)})`;
      }
    }

    let clientBadgeClass = 'unknown';
    let clientBadgeLabel = dev.clientType || 'InkFlow C++ Client';
    
    if (clientBadgeLabel.toLowerCase().includes('esp32')) {
      clientBadgeClass = 'inkflow-esp32';
    } else if (clientBadgeLabel.toLowerCase().includes('r4') || clientBadgeLabel.toLowerCase().includes('renesas')) {
      clientBadgeClass = 'inkflow-r4';
    } else if (clientBadgeLabel.toLowerCase().includes('python')) {
      clientBadgeClass = 'inkflow-python';
    } else if (clientBadgeLabel.toLowerCase().includes('trmnl')) {
      clientBadgeClass = 'trmnl';
    } else if (clientBadgeLabel.toLowerCase().includes('c++') || clientBadgeLabel === 'InkFlow C++ Client') {
      clientBadgeClass = 'inkflow-esp32';
    }
    
    item.innerHTML = `
      <div class="device-info">
        <span class="name">${dev.name}</span>
        <span class="meta">${metaText}</span>
        <div style="margin-top: 4px; display: flex; align-items: center; gap: 6px;">
          <span class="client-badge ${clientBadgeClass}">${clientBadgeLabel}</span>
          ${dev.id.toLowerCase() !== 'default_screen' ? `<button type="button" class="btn-delete-action btn-device-delete" data-device-id="${dev.id}" title="Delete Device" style="margin: 0; padding: 2px 6px; font-size: 10px; line-height: 1; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; height: 18px; width: 18px; text-decoration: none; border: none; cursor: pointer;">🗑️</button>` : ''}
        </div>
      </div>
      <span class="device-badge">${dev.id}</span>
    `;
    
    const btnDel = item.querySelector('.btn-device-delete');
    if (btnDel) {
      btnDel.addEventListener('click', async (e) => {
        e.stopPropagation(); // Avoid selecting the device when clicking delete
        const id = dev.id;
        if (!confirm(`Are you sure you want to permanently remove device '${dev.name}' (${id})? This will purge its cache and remove it from the dashboard console.`)) {
          return;
        }
        
        try {
          const res = await fetch('/api/display/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: id })
          });
          const reply = await res.json();
          if (reply.success) {
            showToast(`Device '${id}' successfully removed!`);
            
            // If the deleted device was the active one, clear selection
            if (activeDeviceId === id) {
              activeDeviceId = null;
              document.getElementById('device-layout-card').style.display = 'none';
            }
            await fetchSettings();
          } else {
            showToast(reply.error || "Failed to delete device", true);
          }
        } catch (err) {
          console.error("Error deleting device:", err);
          showToast("Server connection error while deleting device", true);
        }
      });
    }
    
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
      activePlugins: ["system", "weather", "rss", "notes", "tfl", "uk_trains", "xkcd", "world_clock"],
      layoutMode: "rotation",
      ditherMode: "floyd-steinberg",
      rotationIntervals: {
        weather: 30,
        system: 15,
        rss: 30,
        notes: 15,
        tfl: 30,
        uk_trains: 30,
        xkcd: 30,
        world_clock: 30
      },
      sleepPeriodEnabled: false,
      sleepPeriodStart: "22:00",
      sleepPeriodEnd: "07:00",
      sleepPeriodTimezone: ""
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

    // Load network stats if connected
    const netEl = document.getElementById('edit-device-network');
    if (netEl) {
      if (device.lastIp) {
        netEl.value = device.lastHostname ? `${device.lastHostname} (${device.lastIp})` : device.lastIp;
      } else {
        netEl.value = 'Never connected';
      }
    }

    // Load telemetry stats dynamically
    const telemetryContainer = document.getElementById('device-telemetry-container');
    if (telemetryContainer) {
      if (device.lastIp || device.clientType || device.batteryVoltage || device.rssi) {
        telemetryContainer.style.display = 'grid';
        
        // Client Firmware
        const clientTypeEl = document.getElementById('telemetry-client-type');
        if (clientTypeEl) {
          clientTypeEl.innerText = device.clientType || 'InkFlow C++ Client';
        }
        
        // Firmware Version
        const fwVersionEl = document.getElementById('telemetry-fw-version');
        if (fwVersionEl) {
          fwVersionEl.innerText = device.fwVersion || '1.2.0';
        }
        
        // RSSI WiFi
        const rssiEl = document.getElementById('telemetry-rssi');
        if (rssiEl) {
          if (device.rssi) {
            const dbm = parseInt(device.rssi);
            let rssiIcon = '📶';
            if (dbm > -50) rssiIcon = '🟢';
            else if (dbm > -70) rssiIcon = '🟡';
            else rssiIcon = '🔴';
            rssiEl.innerText = `${rssiIcon} ${device.rssi} dBm`;
          } else {
            rssiEl.innerText = 'N/A';
          }
        }
        
        // Battery Voltage / USB
        const batteryEl = document.getElementById('telemetry-battery');
        if (batteryEl) {
          if (device.batteryVoltage) {
            let batIcon = '🔋';
            if (device.batteryVoltage.includes('V') || !isNaN(parseFloat(device.batteryVoltage))) {
              const volts = parseFloat(device.batteryVoltage);
              if (!isNaN(volts)) {
                if (volts < 3.3) batIcon = '🪫';
                else if (volts < 3.7) batIcon = '🟡';
              }
            } else if (device.batteryVoltage.toLowerCase().includes('usb') || device.batteryVoltage === 'USB') {
              batIcon = '⚡';
            }
            batteryEl.innerText = `${batIcon} ${device.batteryVoltage}`;
          } else {
            batteryEl.innerText = '⚡ USB Powered';
          }
        }
      } else {
        telemetryContainer.style.display = 'none';
      }
    }

    // Checkboxes and inline durations
    renderPluginsSelector(device.activePlugins, device.rotationIntervals || {});

    // Load ditherMode
    document.getElementById('edit-device-dither').value = device.ditherMode || 'floyd-steinberg';

    // Load invertColors
    document.getElementById('edit-device-invert').value = device.invertColors ? 'true' : 'false';

    // Load Quiet Hours
    document.getElementById('edit-device-sleep-enabled').value = device.sleepPeriodEnabled ? 'true' : 'false';
    document.getElementById('edit-device-sleep-start').value = device.sleepPeriodStart || '22:00';
    document.getElementById('edit-device-sleep-end').value = device.sleepPeriodEnd || '07:00';
    document.getElementById('edit-device-sleep-timezone').value = device.sleepPeriodTimezone || '';

    updateScreenMockup(device.id);
    updateGuides(device);

    const sleepScheduleContainer = document.getElementById('device-sleep-schedule-container');
    if (device.id.toLowerCase() === 'default_screen') {
      btnForceRefresh.style.display = 'none';
      btnFlushCache.style.display = 'none';
      if (sleepScheduleContainer) sleepScheduleContainer.style.display = 'none';
    } else {
      btnForceRefresh.style.display = 'inline-flex';
      btnFlushCache.style.display = 'inline-flex';
      if (sleepScheduleContainer) sleepScheduleContainer.style.display = 'block';
    }
  }
}

// Compile dynamic active widget navigation pills
function renderMockupTabs(device) {
  if (!mockupTabsContainer || !mockupTabs) return;
  
  const activePlugins = (device.activePlugins || []).filter(pId => availablePlugins.some(ap => ap.id === pId));
  
  if (activePlugins.length === 0) {
    mockupTabsContainer.style.display = 'none';
    mockupPreviewMode = 'live';
    mockupActivePluginIndex = 0;
    return;
  }
  
  mockupTabsContainer.style.display = 'flex';
  mockupTabs.innerHTML = '';
  
  // 1. Live/Combined screen tab
  const livePill = document.createElement('div');
  livePill.className = 'mockup-tab-pill';
  livePill.innerText = '📺 Combined';
  if (mockupPreviewMode === 'live') {
    livePill.classList.add('active');
    mockupActivePluginIndex = 0;
  }
  
  livePill.addEventListener('click', (e) => {
    e.stopPropagation();
    selectMockupTab(device, 0, 'live', null);
  });
  mockupTabs.appendChild(livePill);
  
  // 2. Individual widget tabs
  activePlugins.forEach((pluginId, idx) => {
    const plugin = availablePlugins.find(ap => ap.id === pluginId);
    const name = plugin ? plugin.name : pluginId;
    const icon = pluginIcons[pluginId] || '🧩';
    
    const pill = document.createElement('div');
    pill.className = 'mockup-tab-pill';
    pill.innerText = `${icon} ${name}`;
    
    const pillIndex = idx + 1;
    if (mockupPreviewMode === 'preview' && mockupPreviewPluginId === pluginId) {
      pill.classList.add('active');
      mockupActivePluginIndex = pillIndex;
    }
    
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      selectMockupTab(device, pillIndex, 'preview', pluginId);
    });
    mockupTabs.appendChild(pill);
  });
  
  // Clamping boundary safety
  const totalTabs = activePlugins.length + 1;
  if (mockupActivePluginIndex >= totalTabs) {
    mockupActivePluginIndex = 0;
    mockupPreviewMode = 'live';
    livePill.classList.add('active');
  }
}

// Select active mockup tab pill dynamically
function selectMockupTab(device, index, mode, pluginId) {
  mockupActivePluginIndex = index;
  mockupPreviewMode = mode;
  mockupPreviewPluginId = pluginId;
  
  const pills = mockupTabs.querySelectorAll('.mockup-tab-pill');
  pills.forEach((p, i) => {
    if (i === index) {
      p.classList.add('active');
      p.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } else {
      p.classList.remove('active');
    }
  });
  
  if (mode === 'live' || !pluginId) {
    const imgUrl = `/api/display/image.png?device=${device.id}&t=${Date.now()}`;
    mockupScreen.innerHTML = '';
    mockupScreen.style.backgroundImage = `url('${imgUrl}')`;
    btnViewPng.href = imgUrl;
    btnViewRaw.href = `/api/display/raw?device=${device.id}&width=${device.width}&height=${device.height}`;
  } else {
    const imgUrl = `/api/display/preview-plugin.png?plugin=${pluginId}&width=${device.width}&height=${device.height}&dither=${device.ditherMode || 'floyd-steinberg'}&t=${Date.now()}`;
    mockupScreen.innerHTML = '';
    mockupScreen.style.backgroundImage = `url('${imgUrl}')`;
    
    btnViewPng.href = imgUrl;
    btnViewRaw.href = `/api/display/preview-plugin.png?plugin=${pluginId}&width=${device.width}&height=${device.height}&dither=${device.ditherMode || 'floyd-steinberg'}&t=${Date.now()}`;
  }
}

// Updates physical bezel screen frame
function updateScreenMockup(deviceId) {
  const device = serverConfig.devices.find(d => d.id === deviceId);
  if (!device) return;

  mockupRes.innerText = `${device.width} x ${device.height}`;
  
  // Aspect ratio adjustment dynamically
  mockupViewport.style.aspectRatio = `${device.width} / ${device.height}`;
  
  // Render tabs dynamically for active plugins
  renderMockupTabs(device);

  // Apply current active tab E-Ink view
  if (mockupPreviewMode === 'live' || !mockupPreviewPluginId) {
    const imgUrl = `/api/display/image.png?device=${device.id}&t=${Date.now()}`;
    mockupScreen.innerHTML = '';
    mockupScreen.style.backgroundImage = `url('${imgUrl}')`;
    btnViewPng.href = imgUrl;
    btnViewRaw.href = `/api/display/raw?device=${device.id}&width=${device.width}&height=${device.height}`;
  } else {
    const imgUrl = `/api/display/preview-plugin.png?plugin=${mockupPreviewPluginId}&width=${device.width}&height=${device.height}&dither=${device.ditherMode || 'floyd-steinberg'}&t=${Date.now()}`;
    mockupScreen.innerHTML = '';
    mockupScreen.style.backgroundImage = `url('${imgUrl}')`;
    btnViewPng.href = imgUrl;
    btnViewRaw.href = `/api/display/preview-plugin.png?plugin=${mockupPreviewPluginId}&width=${device.width}&height=${device.height}&dither=${device.ditherMode || 'floyd-steinberg'}&t=${Date.now()}`;
  }
}

// Guides dynamic URLs updates
function updateGuides(device) {
  const protocol = window.location.protocol;
  const ipHost = `${hostIpAddress}:${hostPort}`;
  
  codeArduino.innerHTML = `${protocol}//${ipHost}/api/display/raw?device=${device.id}&amp;width=${device.width}&amp;height=${device.height}`;
  codePi.innerHTML = `${protocol}//${ipHost}/api/display/image.png?device=${device.id}&amp;width=${device.width}&amp;height=${device.height}`;
  codeTrmnl.innerHTML = `${protocol}//${ipHost}`;
}

// Dynamic Inline Configuration Templates for each plugin
const widgetConfigTemplates = {
  weather: (settings) => `
    <div class="inline-config-form">
      <div class="form-group mb-3">
        <label>UK Postcode (Optional)</label>
        <input type="text" class="inline-cfg-postcode" placeholder="e.g. SW1A 1AA" value="${settings.postcode || ''}">
      </div>
      <div class="form-row">
        <div class="form-group col-6">
          <label>Latitude</label>
          <input type="number" step="0.0001" class="inline-cfg-lat" value="${settings.latitude !== undefined ? settings.latitude : 51.5074}">
        </div>
        <div class="form-group col-6">
          <label>Longitude</label>
          <input type="number" step="0.0001" class="inline-cfg-lon" value="${settings.longitude !== undefined ? settings.longitude : -0.1278}">
        </div>
      </div>
      <div class="form-group">
        <label>Temperature Unit</label>
        <select class="inline-cfg-unit">
          <option value="celsius" ${settings.unit === 'celsius' ? 'selected' : ''}>Celsius (°C)</option>
          <option value="fahrenheit" ${settings.unit === 'fahrenheit' ? 'selected' : ''}>Fahrenheit (°F)</option>
        </select>
      </div>
    </div>
  `,
  rss: (settings) => {
    const feeds = settings.enabledFeeds || ['hn'];
    const customUrl = settings.customUrl || '';
    const limit = settings.limit || 4;
    return `
      <div class="inline-config-form">
        <div class="form-group">
          <label>Select News Feeds (Up to 5)</label>
          <div class="checkbox-grid inline-rss-presets">
            <label class="checkbox-container">
              <input type="checkbox" value="bbc_tech" class="inline-rss-preset-cb" ${feeds.includes('bbc_tech') ? 'checked' : ''}>
              <span class="checkbox-label">💻 Tech</span>
            </label>
            <label class="checkbox-container">
              <input type="checkbox" value="bbc_uk" class="inline-rss-preset-cb" ${feeds.includes('bbc_uk') ? 'checked' : ''}>
              <span class="checkbox-label">🇬🇧 UK</span>
            </label>
            <label class="checkbox-container">
              <input type="checkbox" value="bbc_world" class="inline-rss-preset-cb" ${feeds.includes('bbc_world') ? 'checked' : ''}>
              <span class="checkbox-label">🌍 World</span>
            </label>
            <label class="checkbox-container">
              <input type="checkbox" value="hn" class="inline-rss-preset-cb" ${feeds.includes('hn') ? 'checked' : ''}>
              <span class="checkbox-label">🧡 HN</span>
            </label>
            <label class="checkbox-container">
              <input type="checkbox" value="nyt" class="inline-rss-preset-cb" ${feeds.includes('nyt') ? 'checked' : ''}>
              <span class="checkbox-label">🗞️ NYT</span>
            </label>
            <label class="checkbox-container">
              <input type="checkbox" value="cnn" class="inline-rss-preset-cb" ${feeds.includes('cnn') ? 'checked' : ''}>
              <span class="checkbox-label">🔴 CNN</span>
            </label>
            <label class="checkbox-container">
              <input type="checkbox" value="custom" class="inline-rss-preset-cb inline-rss-custom-cb" ${feeds.includes('custom') ? 'checked' : ''}>
              <span class="checkbox-label">⚙️ Custom</span>
            </label>
          </div>
        </div>
        <div class="form-group inline-rss-custom-group" style="display: ${feeds.includes('custom') ? 'block' : 'none'};">
          <label>Custom XML RSS URL</label>
          <input type="url" class="inline-cfg-rss-url" placeholder="https://news.ycombinator.com/rss" value="${customUrl}">
        </div>
        <div class="form-group">
          <label>Max Articles</label>
          <input type="number" class="inline-cfg-rss-limit" min="1" max="8" value="${limit}">
        </div>
      </div>
    `;
  },
  tfl: (settings) => `
    <div class="inline-config-form">
      <div class="form-group">
        <label>Included Rail Modes</label>
        <input type="text" class="inline-cfg-tfl-modes" placeholder="tube,overground,dlr,elizabeth-line" value="${settings.modes || 'tube,overground,dlr,elizabeth-line'}">
        <span class="input-hint">tube, overground, dlr, elizabeth-line, tram</span>
      </div>
    </div>
  `,
  uk_trains: (settings) => `
    <div class="inline-config-form">
      <div class="form-group">
        <label>Station CRS Code (3 letters)</label>
        <input type="text" class="inline-cfg-trains-crs" placeholder="e.g. LST" maxlength="3" style="text-transform: uppercase;" value="${settings.crs || 'LST'}">
      </div>
      <div class="form-group">
        <label>Filter Station Code (Optional, comma-separated list)</label>
        <input type="text" class="inline-cfg-trains-filter" placeholder="e.g. CBG, KGX" maxlength="50" style="text-transform: uppercase;" value="${settings.filterCrs || ''}">
      </div>
      <div class="form-group">
        <label>Board Mode</label>
        <select class="inline-cfg-trains-mode">
          <option value="departures" ${settings.mode === 'departures' ? 'selected' : ''}>Departures</option>
          <option value="arrivals" ${settings.mode === 'arrivals' ? 'selected' : ''}>Arrivals</option>
        </select>
      </div>
      <div class="form-group">
        <label>Maximum Services Shown</label>
        <input type="number" class="inline-cfg-trains-limit" min="1" max="10" value="${settings.limit || 6}">
      </div>
    </div>
  `,
  xkcd: (settings) => `
    <div class="inline-config-form">
      <div class="form-group">
        <label>Retrieval Mode</label>
        <select class="inline-cfg-xkcd-mode">
          <option value="latest" ${settings.mode === 'latest' ? 'selected' : ''}>Latest Comic Strip</option>
          <option value="sequential" ${settings.mode === 'sequential' ? 'selected' : ''}>Sequential RSS cycling</option>
          <option value="random" ${settings.mode === 'random' ? 'selected' : ''}>Random Archive Comic</option>
        </select>
      </div>
    </div>
  `,
  notes: (settings) => `
    <div class="inline-config-form">
      <div class="form-group">
        <label>Notice Board Title</label>
        <input type="text" class="inline-cfg-todo-title" value="${settings.title || 'Notice Board'}">
      </div>
      <div class="form-group">
        <label>Task Check List</label>
        <div class="todo-editor-list inline-todo-list" style="max-height: 150px; overflow-y: auto; margin-top: 6px; padding: 4px;">
          <!-- Dynamically loaded checklist -->
        </div>
        <div class="todo-add-row mt-2" style="display:flex; gap:6px;">
          <input type="text" class="inline-todo-add-input" placeholder="Add chore..." style="flex:1;">
          <button class="btn btn-primary btn-inline-todo-add" style="padding:0 12px; font-size:16px;">+</button>
        </div>
      </div>
    </div>
  `,
  world_clock: (settings) => `
    <div class="inline-config-form">
      <div class="form-group">
        <label>Local Timezone</label>
        <input type="text" class="inline-cfg-wc-tz" placeholder="e.g. Europe/London" value="${settings.timezone || 'Europe/London'}">
      </div>
      <div class="form-row">
        <div class="form-group col-6">
          <label>Latitude</label>
          <input type="number" step="0.0001" class="inline-cfg-wc-lat" placeholder="51.5074" value="${settings.latitude !== undefined ? settings.latitude : 51.5074}">
        </div>
        <div class="form-group col-6">
          <label>Longitude</label>
          <input type="number" step="0.0001" class="inline-cfg-wc-lon" placeholder="-0.1278" value="${settings.longitude !== undefined ? settings.longitude : -0.1278}">
        </div>
      </div>
      <div class="form-group">
        <label>Map Render Style</label>
        <select class="inline-cfg-wc-style">
          <option value="hires" ${settings.mapStyle === 'hires' ? 'selected' : ''}>High-Resolution Map</option>
          <option value="solid" ${settings.mapStyle === 'solid' ? 'selected' : ''}>Dithered Solid Grid</option>
          <option value="dots" ${settings.mapStyle === 'dots' ? 'selected' : ''}>Dot-Matrix Map</option>
        </select>
      </div>
    </div>
  `
};

// Compile custom settings forms dynamically for AI generated widgets with configFields
function generateDynamicConfigForm(configFields, settings) {
  let html = `<div class="inline-config-form dynamic-config-form">`;
  configFields.forEach(field => {
    const value = settings[field.key] !== undefined ? settings[field.key] : (field.default !== undefined ? field.default : '');
    
    // Dynamically resolve help link label based on key and custom field configuration
    let helpLabelText = 'ℹ️ Learn More';
    if (field.helpLabel) {
      helpLabelText = field.helpLabel;
    } else {
      const lowerKey = (field.key || '').toLowerCase();
      const lowerLabel = (field.label || '').toLowerCase();
      if (lowerKey.includes('key') || lowerKey.includes('token') || lowerKey.includes('pass') || lowerKey.includes('secret') || lowerKey.includes('cred') || lowerKey.includes('auth') ||
          lowerLabel.includes('key') || lowerLabel.includes('token') || lowerLabel.includes('pass') || lowerLabel.includes('secret') || lowerLabel.includes('cred') || lowerLabel.includes('auth')) {
        helpLabelText = '🔑 Get Key';
      } else if (lowerKey.includes('lat') || lowerKey.includes('lon') || lowerKey.includes('coord') || lowerKey.includes('loc') || lowerKey.includes('map') ||
                 lowerLabel.includes('lat') || lowerLabel.includes('lon') || lowerLabel.includes('coord') || lowerLabel.includes('loc') || lowerLabel.includes('map')) {
        helpLabelText = '📍 Find Coordinates';
      } else if (lowerKey.includes('city') || lowerKey.includes('station') || lowerKey.includes('airport') ||
                 lowerLabel.includes('city') || lowerLabel.includes('station') || lowerLabel.includes('airport')) {
        helpLabelText = '🌐 Search';
      }
    }

    html += `<div class="form-group">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <label style="margin-bottom:0;">${field.label || field.key}</label>
        ${field.helpUrl ? `<a href="${field.helpUrl}" target="_blank" style="font-size:10px; color:var(--accent-cyan); text-decoration:none;" onclick="event.stopPropagation();">${helpLabelText}</a>` : ''}
      </div>`;
    
    if (field.type === 'select' && Array.isArray(field.options)) {
      html += `<select class="inline-dyn-cfg" data-key="${field.key}">`;
      field.options.forEach(opt => {
        const isSel = opt === value ? 'selected' : '';
        html += `<option value="${opt}" ${isSel}>${opt}</option>`;
      });
      html += `</select>`;
    } else if (field.type === 'number') {
      html += `<input type="number" class="inline-dyn-cfg" data-key="${field.key}" value="${value}">`;
    } else {
      const isApiKey = field.key.toLowerCase().includes('key') || field.key.toLowerCase().includes('token') || field.key.toLowerCase().includes('password');
      const inputType = isApiKey ? 'password' : 'text';
      html += `<input type="${inputType}" class="inline-dyn-cfg" data-key="${field.key}" value="${value}" placeholder="Enter ${field.label || field.key}">`;
    }
    html += `</div>`;
  });
  html += `</div>`;
  return html;
}

// Toast indicator animation
let toastTimeout = null;
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }

  if (isError) {
    toast.innerText = message + "\n\n(Click to copy error details & dismiss)";
    toast.style.background = 'rgba(255, 23, 68, 0.98)';
    toast.style.color = '#ffffff';
    toast.style.boxShadow = '0 4px 20px rgba(255, 23, 68, 0.45)';
  } else {
    toast.innerText = message;
    toast.style.background = 'rgba(0, 230, 118, 0.95)';
    toast.style.color = '#020604';
    toast.style.boxShadow = '0 4px 15px rgba(0, 230, 118, 0.35)';
  }

  toast.onclick = () => {
    if (isError) {
      navigator.clipboard.writeText(message).then(() => {
        console.log("Error details copied to clipboard!");
      }).catch(err => {
        console.error("Failed to copy error details to clipboard: ", err);
      });
    }
    toast.classList.remove('show');
  };

  toast.classList.add('show');

  // Success/info dismisses in 3.5 seconds. Errors persist for 15 seconds to allow reading.
  const duration = isError ? 15000 : 3500;
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// Premium Dynamic Graph Renderer
function drawTelemetryGraph() {
  if (!telemetryGraph) return;
  const ctx = telemetryGraph.getContext('2d');
  
  // Set display resolution to match container styling perfectly
  const dpr = window.devicePixelRatio || 1;
  const rect = telemetryGraph.getBoundingClientRect();
  telemetryGraph.width = rect.width * dpr;
  telemetryGraph.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  
  const width = rect.width;
  const height = rect.height;
  
  // Clear the canvas
  ctx.clearRect(0, 0, width, height);
  
  if (telemetryHistory.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Compiling Live Stream Graphs...', width / 2, height / 2);
    return;
  }
  
  const paddingX = 8;
  const paddingY = 8;
  const plotStartX = paddingX + 55;
  const plotWidth = width - paddingX - plotStartX;
  const graphHeight = height - 2 * paddingY;
  
  // Draw grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const yLine = paddingY + (i / 4) * graphHeight;
    ctx.beginPath();
    ctx.moveTo(plotStartX, yLine);
    ctx.lineTo(width - paddingX, yLine);
    ctx.stroke();
  }
  
  // Helper to draw a glowing line
  const drawLine = (key, color, maxVal) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    
    // Add glowing line shadows
    ctx.shadowBlur = 6;
    ctx.shadowColor = color;
    
    for (let i = 0; i < telemetryHistory.length; i++) {
      const val = telemetryHistory[i][key];
      const pct = Math.min(100, Math.max(0, val)) / maxVal;
      
      const x = plotStartX + (i / (maxTelemetryPoints - 1)) * plotWidth;
      const y = height - paddingY - pct * graphHeight;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    
    // Reset shadow for next operations
    ctx.shadowBlur = 0;
  };
  
  // Draw 3 layers: CPU Temp (Red), Free RAM (Green), CPU Usage (Cyan)
  drawLine('temp', '#ff3d57', 100);
  drawLine('ramFree', '#00e676', 100);
  drawLine('cpu', '#00f0ff', 100);

  // Draw Vertical Axis Range Labels (top/middle/bottom)
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '8px monospace';
  
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('100% / 100°C', paddingX + 2, paddingY);
  
  ctx.textBaseline = 'middle';
  ctx.fillText('50% / 50°C', paddingX + 2, paddingY + graphHeight / 2);
  
  ctx.textBaseline = 'bottom';
  ctx.fillText('0% / 0°C', paddingX + 2, height - paddingY);

  // Draw Legend vertically aligned at top-right
  const drawLegend = () => {
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    
    const items = [
      { label: 'RAM Free', color: '#00e676' },
      { label: 'Temp', color: '#ff3d57' },
      { label: 'CPU Load', color: '#00f0ff' }
    ];
    
    let maxItemWidth = 0;
    items.forEach(item => {
      const w = ctx.measureText(item.label).width;
      if (w > maxItemWidth) maxItemWidth = w;
    });
    const totalLegendWidth = maxItemWidth + 20;

    const boxX = width - paddingX - totalLegendWidth - 6;
    const boxY = paddingY - 2;
    const boxW = totalLegendWidth + 12;
    const boxH = 39;
    
    ctx.fillStyle = 'rgba(15, 16, 22, 0.85)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      ctx.fill();
    } else {
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }
    
    let currentX = width - paddingX - 4;
    
    items.forEach((item, index) => {
      const y = paddingY + 2 + index * 12;
      
      // Print text label
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(item.label, currentX, y);
      const textWidth = ctx.measureText(item.label).width;
      
      // Draw indicator colored dot
      ctx.beginPath();
      ctx.fillStyle = item.color;
      ctx.arc(currentX - textWidth - 6, y + 4.5, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };
  
  drawLegend();
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
      cpuText.textContent = `${val}%`;
      cpuChart.setAttribute('stroke-dasharray', `${val}, 100`);
      
      // Update metadata text
      telemetryTemp.innerText = `${data.cpuTemp}°C`;
      telemetryRam.innerText = data.ramText || '--';
      
      // Calculate Free RAM percentage
      const ramFreePct = data.ramUsage || 0;
      const rawTemp = parseFloat(data.cpuTemp) || 40.0;
      
      // Push and cap history points
      telemetryHistory.push({
        temp: rawTemp,
        ramFree: ramFreePct,
        cpu: val
      });
      if (telemetryHistory.length > maxTelemetryPoints) {
        telemetryHistory.shift();
      }
      
      // Render the glowing graph
      drawTelemetryGraph();

      // Reset smooth seconds counter
      clearInterval(uptimeInterval);
      uptimeSeconds = Math.floor(data.uptimeRaw || 0);
      
      const formatUptime = (totalSeconds) => {
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = Math.floor(totalSeconds % 60);
        return `${days > 0 ? days + 'd ' : ''}${hours}h ${mins}m ${secs}s`;
      };
      
      telemetryUptime.innerText = formatUptime(uptimeSeconds);
      
      uptimeInterval = setInterval(() => {
        uptimeSeconds++;
        telemetryUptime.innerText = formatUptime(uptimeSeconds);
      }, 1000);

    } catch (e) {
      console.warn("Telemetry offline (disconnected from live Pi telemetry)");
    }
  };
  
  await updateStats();
  setInterval(updateStats, 3000);
  
  // Handle resize events to redraw canvas correctly
  window.addEventListener('resize', drawTelemetryGraph);
}

// Background sync loop to auto-discover registered screens
function startDeviceListSync() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const latestConfig = await res.json();
      
      let hasNewDevice = false;
      latestConfig.devices.forEach(d => {
        // Add new devices that auto-registered on the backend
        if (!serverConfig.devices.find(existing => existing.id === d.id)) {
          serverConfig.devices.push(d);
          hasNewDevice = true;
        }
      });
      
      if (hasNewDevice) {
        renderDevicesList();
        showToast("New display screen auto-discovered!");
      }
    } catch (err) {
      console.warn("Background device sync offline:", err);
    }
  }, 10000);
}

// Main Top-Level Tabs UI handler
function setupMainTabs() {
  document.querySelectorAll('.main-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.main-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.main-tab-view').forEach(view => view.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = btn.dataset.mainTab;
      document.getElementById(targetId).classList.add('active');
      
      // Auto refresh previews or load AI configs when switching
      if (targetId === 'main-tab-widgets') {
        renderHostedWidgetsList(widgetSearch ? widgetSearch.value : '');
        updateAiPreviewMockup(activePreviewPluginId);
        stopOllamaPolling();
      } else if (targetId === 'main-tab-ai-admin') {
        fetchAiEnvConfig();
        fetchOllamaStatus();
        startOllamaPolling();
      } else {
        if (activeDeviceId) {
          updateScreenMockup(activeDeviceId);
        }
        stopOllamaPolling();
      }
    });
  });
}

// Connection Guide Tabs UI handler
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

// Updates the secondary AI preview bezel screen frame
function updateAiPreviewMockup(pluginId) {
  if (!pluginId || !aiMockupScreen) return;
  activePreviewPluginId = pluginId;

  // Render outline highlight in list
  document.querySelectorAll('.hosted-widget-item').forEach(el => {
    if (el.dataset.id === pluginId) el.classList.add('active-preview');
    else el.classList.remove('active-preview');
  });

  const width = 800; // default preview size
  const height = 480;
  if (aiMockupRes) aiMockupRes.innerText = `${width} x ${height}`;
  if (aiMockupViewport) aiMockupViewport.style.aspectRatio = `${width} / ${height}`;

  const imgUrl = `/api/display/preview-plugin.png?plugin=${pluginId}&width=${width}&height=${height}&t=${Date.now()}`;
  aiMockupScreen.innerHTML = '';
  aiMockupScreen.style.backgroundImage = `url('${imgUrl}')`;

  // Update PNG URL link
  if (btnAiViewPng) btnAiViewPng.href = imgUrl;
}

// Renders the list of hosted widgets on Tab 2 with modular in-tile options forms
function renderHostedWidgetsList(filterText = '') {
  if (!hostedWidgetsGrid) return;
  hostedWidgetsGrid.innerHTML = '';

  const query = filterText.toLowerCase().trim();

  // List of core built-in plugin IDs to distinguish from AI ones
  const corePluginIds = ['weather', 'system', 'rss', 'notes', 'tfl', 'uk_trains', 'xkcd', 'world_clock', 'ai_briefing', 'ai_advisor', 'airport_board', 'tide_timetable', 'uk_fuel'];

  const filtered = availablePlugins.filter(plugin => {
    return plugin.name.toLowerCase().includes(query) || 
           plugin.id.toLowerCase().includes(query) ||
           (plugin.description || '').toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    hostedWidgetsGrid.innerHTML = `<p class="card-help text-center" style="grid-column: 1/-1; padding: 20px;">No hosted widgets match your search.</p>`;
    return;
  }

  filtered.forEach(plugin => {
    const isCore = corePluginIds.includes(plugin.id);
    const badgeText = isCore ? 'Core Plugin' : 'AI Generated';
    const badgeClass = isCore ? 'core' : 'ai';
    const icon = pluginIcons[plugin.id] || '🧩';

    const card = document.createElement('div');
    card.className = `hosted-widget-item ${plugin.id === activePreviewPluginId ? 'active-preview' : ''}`;
    card.dataset.id = plugin.id;

    card.innerHTML = `
      <div class="hosted-widget-header">
        <div class="hosted-widget-icon">${icon}</div>
        <div class="hosted-widget-info">
          <span class="hosted-widget-name">${plugin.name}</span>
          <span class="hosted-widget-id">${plugin.id}</span>
        </div>
      </div>
      <p class="hosted-widget-desc">${plugin.description || 'Custom compiled E-Ink widget.'}</p>
      
      ${!isCore ? `
      <div class="hosted-widget-refine-container" id="refine-container-${plugin.id}" style="display: none; padding-top: 10px; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
        <textarea class="refine-prompt-input" placeholder="What changes would you like to make to this widget? (e.g. 'Make font bigger', 'Center all fields', 'Add borders')" style="width: 100%; min-height: 50px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff; padding: 6px; font-size: 0.85rem; resize: vertical; margin-bottom: 5px; box-sizing: border-box;"></textarea>
        <button class="btn btn-primary btn-sm btn-submit-refine" data-plugin-id="${plugin.id}" style="width: 100%; font-size: 0.8rem; padding: 4px 8px; font-weight: 500; cursor: pointer;">✨ Apply Changes</button>
      </div>
      ` : ''}

      <div class="hosted-widget-meta">
        <span class="hosted-widget-badge ${badgeClass}">${badgeText}</span>
        <div class="hosted-widget-actions">
          <button class="btn-preview-action" data-plugin-id="${plugin.id}">🔬 Preview</button>
          ${!isCore ? `
          <button class="btn-refine-toggle" data-plugin-id="${plugin.id}" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); color: #e2e8f0; font-size: 0.8rem; padding: 3px 8px; border-radius: 4px; cursor: pointer; transition: all 0.2s;" title="Refine or change this widget's layout/logic">✍️ Refine</button>
          <button class="btn-delete-action" data-plugin-id="${plugin.id}" title="Delete this AI generated widget">🗑️ Delete</button>
          ` : ''}
        </div>
      </div>
    `;

    // Click on preview button triggers render only
    card.querySelector('.btn-preview-action').addEventListener('click', (e) => {
      e.stopPropagation();
      updateAiPreviewMockup(plugin.id);
    });

    // Refinement toggle and submit listeners
    if (!isCore) {
      const btnRefineToggle = card.querySelector('.btn-refine-toggle');
      const refineContainer = card.querySelector('.hosted-widget-refine-container');
      if (btnRefineToggle && refineContainer) {
        btnRefineToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const isCollapsed = refineContainer.style.display === 'none';
          refineContainer.style.display = isCollapsed ? 'block' : 'none';
          btnRefineToggle.style.background = isCollapsed ? 'rgba(79, 70, 229, 0.4)' : 'rgba(255, 255, 255, 0.1)';
        });
      }

      const btnSubmitRefine = card.querySelector('.btn-submit-refine');
      const txtRefinePrompt = card.querySelector('.refine-prompt-input');
      if (btnSubmitRefine && txtRefinePrompt) {
        btnSubmitRefine.addEventListener('click', async (e) => {
          e.stopPropagation();
          const promptText = txtRefinePrompt.value.trim();
          if (!promptText) {
            alert("Please describe the changes you want to apply first!");
            return;
          }

          const engineName = getActiveBuilderName();
          btnSubmitRefine.disabled = true;
          btnSubmitRefine.innerText = "Applying changes...";
          txtRefinePrompt.disabled = true;

          if (aiLoadingContainer && aiLoadingText) {
            aiLoadingContainer.style.display = 'block';
            aiLoadingText.innerText = `${engineName} is refactoring E-Ink layout code...`;
          }

          try {
            const response = await fetch('/api/ai/refine', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pluginId: plugin.id, prompt: promptText })
            });
            const reply = await response.json();

            if (reply.success) {
              showToast(`Widget refined successfully!`);
              txtRefinePrompt.value = '';
              refineContainer.style.display = 'none';
              if (btnRefineToggle) {
                btnRefineToggle.style.background = 'rgba(255, 255, 255, 0.1)';
              }

              await fetchPlugins();
              renderHostedWidgetsList();
              updateAiPreviewMockup(plugin.id);
              if (activeDeviceId) {
                await triggerManualRefresh(activeDeviceId);
              }
            } else {
              showToast(reply.error || "Refinement failed!", true);
            }
          } catch (err) {
            console.error("AI Widget refinement error:", err);
            showToast("Server error during widget refinement!", true);
          } finally {
            btnSubmitRefine.disabled = false;
            btnSubmitRefine.innerText = "✨ Apply Changes";
            txtRefinePrompt.disabled = false;
            if (aiLoadingContainer) {
              aiLoadingContainer.style.display = 'none';
            }
          }
        });
      }

      const btnDelete = card.querySelector('.btn-delete-action');
      if (btnDelete) {
        btnDelete.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = confirm(`Are you sure you want to delete the dynamic AI widget '${plugin.name}' (${plugin.id})? This will permanently remove its file, settings, cache, and rotation sequences!`);
          if (!confirmed) return;

          btnDelete.disabled = true;
          btnDelete.innerText = "Deleting...";
          try {
            const res = await fetch(`/api/plugins/${plugin.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
              showToast(data.message || "Widget deleted successfully.");
              if (activePreviewPluginId === plugin.id) {
                activePreviewPluginId = null;
                const mockupImg = document.getElementById('mockup-img');
                if (mockupImg) mockupImg.src = '';
                const mockupDitheredImg = document.getElementById('mockup-dithered-img');
                if (mockupDitheredImg) mockupDitheredImg.style.display = 'none';
              }
              await fetchPlugins();
              await fetchSettings();
              renderHostedWidgetsList();
              if (typeof populateDeviceOptions === 'function') {
                populateDeviceOptions();
              }
            } else {
              showToast(data.error || "Failed to delete widget.", true);
            }
          } catch (err) {
            console.error("Delete widget error:", err);
            showToast("Network error. Failed to delete widget.", true);
          } finally {
            btnDelete.disabled = false;
            btnDelete.innerText = "🗑️ Delete";
          }
        });
      }
    }

    // Check if there is a config form template defined for this plugin or custom config fields
    const hasConfig = true; // All plugins have at least the refresh period config
    if (hasConfig) {
      const settings = serverConfig.settings[plugin.id] || {};
      let inlineHTML = '';
      if (typeof widgetConfigTemplates[plugin.id] === 'function') {
        inlineHTML = widgetConfigTemplates[plugin.id](settings);
      } else if (plugin.configFields && plugin.configFields.length > 0) {
        const filteredFields = plugin.configFields.filter(f => f.key !== 'refreshHours' && f.key !== 'refreshMinutes');
        inlineHTML = generateDynamicConfigForm(filteredFields, settings);
      }
      
      // Resolve defaults for refresh period
      let defaultHours = 0;
      let defaultMinutes = 0;
      if (plugin.configFields) {
        const hField = plugin.configFields.find(f => f.key === 'refreshHours');
        if (hField && hField.default !== undefined) {
          defaultHours = parseInt(hField.default) || 0;
        }
        const mField = plugin.configFields.find(f => f.key === 'refreshMinutes');
        if (mField && mField.default !== undefined) {
          defaultMinutes = parseInt(mField.default) || 0;
        }
      }

      const refreshHtml = `
        <div class="form-group mb-3 refresh-period-group">
          <label>Cache Refresh Period</label>
          <div style="display: flex; gap: 10px;">
            <div style="flex: 1;">
              <span style="font-size: 10px; opacity: 0.6; display: block; margin-bottom: 2px;">Hours</span>
              <input type="number" class="inline-cfg-refresh-hours" min="0" placeholder="0" value="${settings.refreshHours !== undefined ? settings.refreshHours : defaultHours}">
            </div>
            <div style="flex: 1;">
              <span style="font-size: 10px; opacity: 0.6; display: block; margin-bottom: 2px;">Minutes</span>
              <input type="number" class="inline-cfg-refresh-minutes" min="0" max="59" placeholder="0" value="${settings.refreshMinutes !== undefined ? settings.refreshMinutes : defaultMinutes}">
            </div>
          </div>
        </div>
      `;

      const configWrapper = document.createElement('div');
      configWrapper.className = 'hosted-widget-config-container';
      configWrapper.style.display = 'none';
      configWrapper.innerHTML = `
        ${inlineHTML}
        ${refreshHtml}
        <div class="inline-config-actions">
          <button type="button" class="btn-save-inline-config">Save Options</button>
        </div>
      `;
      card.appendChild(configWrapper);

      // Stop propagation inside config panel so typing doesn't trigger parent card events
      configWrapper.addEventListener('click', (e) => e.stopPropagation());
      configWrapper.addEventListener('mousedown', (e) => e.stopPropagation());

      // Bind plugin-specific sub-controllers
      if (plugin.id === 'rss') {
        const customCb = configWrapper.querySelector('.inline-rss-custom-cb');
        const customGroup = configWrapper.querySelector('.inline-rss-custom-group');
        if (customCb && customGroup) {
          customCb.addEventListener('change', () => {
            customGroup.style.display = customCb.checked ? 'block' : 'none';
          });
        }

        configWrapper.querySelectorAll('.inline-rss-preset-cb').forEach(cb => {
          cb.addEventListener('change', () => {
            const checkedCount = configWrapper.querySelectorAll('.inline-rss-preset-cb:checked').length;
            if (checkedCount > 5) {
              cb.checked = false;
              if (cb === customCb && customGroup) {
                customGroup.style.display = 'none';
              }
              showToast("You can select up to 5 RSS feeds!", true);
            }
          });
        });
      }

      if (plugin.id === 'notes') {
        const todoListContainer = configWrapper.querySelector('.inline-todo-list');
        if (!settings.items) {
          settings.items = [];
        }
        const items = settings.items;
        
        const renderInlineTodoList = () => {
          todoListContainer.innerHTML = '';
          if (items.length === 0) {
            todoListContainer.innerHTML = `<span class="text-sm" style="display:block;padding:6px;color:rgba(255,255,255,0.4);text-align:center;">Notice checklist is empty.</span>`;
            return;
          }
          items.forEach((item, index) => {
            const isCompleted = item.startsWith('[x]');
            const cleanText = item.replace(/^\[[ x]\]\s*/, '');
            
            const row = document.createElement('div');
            row.className = 'todo-editor-item inline-todo-item-row';
            row.style.padding = '4px 8px';
            row.style.marginBottom = '4px';
            row.style.background = 'rgba(255,255,255,0.02)';
            row.style.borderRadius = '6px';
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            if (isCompleted) row.classList.add('completed');
            
            row.innerHTML = `
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="checkbox" class="todo-check inline-todo-check" ${isCompleted ? 'checked' : ''}>
                <span style="font-size:12px;">${cleanText}</span>
              </div>
              <button class="btn-todo-del inline-todo-del-btn" style="padding:0 4px;font-size:14px;cursor:pointer;">×</button>
            `;
            
            row.querySelector('.inline-todo-check').addEventListener('change', (e) => {
              if (e.target.checked) {
                row.classList.add('completed');
                items[index] = `[x] ${cleanText}`;
              } else {
                row.classList.remove('completed');
                items[index] = `[ ] ${cleanText}`;
              }
            });
            
            row.querySelector('.inline-todo-del-btn').addEventListener('click', (e) => {
              e.stopPropagation();
              items.splice(index, 1);
              renderInlineTodoList();
            });
            
            todoListContainer.appendChild(row);
          });
        };
        
        renderInlineTodoList();

        const addBtn = configWrapper.querySelector('.btn-inline-todo-add');
        const addInput = configWrapper.querySelector('.inline-todo-add-input');
        
        const addInlineTodo = (e) => {
          if (e) e.stopPropagation();
          const text = addInput.value.trim();
          if (!text) return;
          items.push(`[ ] ${text}`);
          addInput.value = '';
          renderInlineTodoList();
          addInput.focus();
        };
        
        addBtn.addEventListener('click', addInlineTodo);
        addInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            addInlineTodo();
          }
        });
      }

      // Bind in-card Save Options button
      const btnSave = configWrapper.querySelector('.btn-save-inline-config');
      btnSave.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        // Grab inputs inside this card
        if (plugin.id === 'weather') {
          serverConfig.settings.weather = {
            postcode: configWrapper.querySelector('.inline-cfg-postcode').value.trim() || '',
            latitude: parseFloat(configWrapper.querySelector('.inline-cfg-lat').value) || 51.5074,
            longitude: parseFloat(configWrapper.querySelector('.inline-cfg-lon').value) || -0.1278,
            unit: configWrapper.querySelector('.inline-cfg-unit').value
          };
        } else if (plugin.id === 'rss') {
          const enabledFeeds = [];
          configWrapper.querySelectorAll('.inline-rss-preset-cb:checked').forEach(cb => {
            enabledFeeds.push(cb.value);
          });
          if (enabledFeeds.length === 0) enabledFeeds.push('hn');

          serverConfig.settings.rss = {
            enabledFeeds,
            customUrl: configWrapper.querySelector('.inline-cfg-rss-url').value || '',
            limit: parseInt(configWrapper.querySelector('.inline-cfg-rss-limit').value) || 4
          };
        } else if (plugin.id === 'tfl') {
          serverConfig.settings.tfl = {
            modes: configWrapper.querySelector('.inline-cfg-tfl-modes').value || 'tube,overground,dlr,elizabeth-line'
          };
        } else if (plugin.id === 'uk_trains') {
          serverConfig.settings.uk_trains = {
            crs: configWrapper.querySelector('.inline-cfg-trains-crs').value.toUpperCase() || 'LST',
            filterCrs: configWrapper.querySelector('.inline-cfg-trains-filter').value.toUpperCase() || '',
            mode: configWrapper.querySelector('.inline-cfg-trains-mode').value,
            limit: parseInt(configWrapper.querySelector('.inline-cfg-trains-limit').value) || 6
          };
        } else if (plugin.id === 'xkcd') {
          serverConfig.settings.xkcd = {
            mode: configWrapper.querySelector('.inline-cfg-xkcd-mode').value
          };
        } else if (plugin.id === 'notes') {
          // Task checklist items are already mutated reactively in items array
          serverConfig.settings.notes = {
            title: configWrapper.querySelector('.inline-cfg-todo-title').value || 'Notice Board',
            items: settings.items || []
          };
        } else if (plugin.id === 'world_clock') {
          serverConfig.settings.world_clock = {
            timezone: configWrapper.querySelector('.inline-cfg-wc-tz').value || 'Europe/London',
            latitude: parseFloat(configWrapper.querySelector('.inline-cfg-wc-lat').value) || 51.5074,
            longitude: parseFloat(configWrapper.querySelector('.inline-cfg-wc-lon').value) || -0.1278,
            mapStyle: configWrapper.querySelector('.inline-cfg-wc-style').value
          };
        } else {
          // Dynamic settings harvester for AI-generated or custom widgets with configFields
          const dynInputs = configWrapper.querySelectorAll('.inline-dyn-cfg');
          if (dynInputs.length > 0) {
            if (!serverConfig.settings[plugin.id]) {
              serverConfig.settings[plugin.id] = {};
            }
            dynInputs.forEach(input => {
              const key = input.dataset.key;
              let val = input.value;
              if (input.type === 'number') {
                val = parseFloat(val) || 0;
              }
              serverConfig.settings[plugin.id][key] = val;
            });
          }
        }

        // Always harvest the refresh period fields for every plugin
        if (!serverConfig.settings[plugin.id]) {
          serverConfig.settings[plugin.id] = {};
        }
        const hoursVal = parseInt(configWrapper.querySelector('.inline-cfg-refresh-hours').value);
        const minsVal = parseInt(configWrapper.querySelector('.inline-cfg-refresh-minutes').value);
        serverConfig.settings[plugin.id].refreshHours = !isNaN(hoursVal) ? hoursVal : 0;
        serverConfig.settings[plugin.id].refreshMinutes = !isNaN(minsVal) ? minsVal : 0;

        btnSave.disabled = true;
        btnSave.innerText = "Saving...";
        try {
          await saveSettings();
          updateAiPreviewMockup(plugin.id);
        } finally {
          btnSave.disabled = false;
          btnSave.innerText = "Save Options";
        }
      });

      // Card-level accordion toggle click listener
      card.addEventListener('click', (e) => {
        // Prevent toggle if we explicitly clicked inside the config form itself or on the preview button
        if (e.target.closest('.hosted-widget-config-container') || e.target.closest('.btn-preview-action')) {
          return;
        }

        // Preview it
        updateAiPreviewMockup(plugin.id);

        const isOpen = card.classList.contains('config-expanded');

        // Collapse all other tiles
        document.querySelectorAll('.hosted-widget-item').forEach(otherCard => {
          if (otherCard !== card) {
            otherCard.classList.remove('config-expanded');
            const panel = otherCard.querySelector('.hosted-widget-config-container');
            if (panel) panel.style.display = 'none';
          }
        });

        // Toggle current
        if (isOpen) {
          card.classList.remove('config-expanded');
          configWrapper.style.display = 'none';
        } else {
          card.classList.add('config-expanded');
          configWrapper.style.display = 'block';
        }
      });

    } else {
      // Direct catalog click behavior if no options form is available (e.g. dynamic custom AI widgets)
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-preview-action')) return;
        updateAiPreviewMockup(plugin.id);
      });
    }

    hostedWidgetsGrid.appendChild(card);
  });
}

// =========================================================================
// 🧠 Tab 3: AI & Ollama Admin Client-Side Controllers & Polling Loops
// =========================================================================

let ollamaStatusInterval = null;
let ollamaPullInterval = null;
let savedOllamaModel = 'llama3.2:1b';

// Helper to update active AI engine badges
function updateEngineBadge(elementId, engine, selectedProvider) {
  const badge = document.getElementById(elementId);
  if (!badge) return;

  badge.className = 'ollama-status-badge';
  badge.title = '';

  const formatEngineName = (name) => {
    if (name === 'gemini') return 'Gemini';
    if (name === 'groq') return 'Groq';
    if (name === 'ollama') return 'Ollama';
    return 'None';
  };

  if (!engine || engine === 'none') {
    badge.innerText = 'Disabled';
    badge.classList.add('disabled');
  } else {
    const formatted = formatEngineName(engine);
    if (engine === 'ollama') {
      badge.innerText = `Active: ${formatted} (Local)`;
      badge.classList.add('local');
    } else {
      badge.innerText = `Active: ${formatted}`;
      badge.classList.add('online');
    }

    // Highlight discrepancy/fallback if they don't match
    if (selectedProvider && selectedProvider !== 'none' && selectedProvider !== engine) {
      badge.innerText = `Fallback: ${formatted}`;
      badge.className = 'ollama-status-badge offline';
      badge.title = `Discrepancy: You selected ${formatEngineName(selectedProvider)} but the server fell back to ${formatted} (verify API keys).`;
    }
  }
}

// Fetch AI Environment configurations from server
async function fetchAiEnvConfig() {
  try {
    const res = await fetch('/api/ai/env');
    if (!res.ok) throw new Error("Server error");
    const data = await res.json();
    
    document.getElementById('ai-env-builder-provider').value = data.widgetBuilderProvider;
    document.getElementById('ai-env-widgets-provider').value = data.dynamicWidgetsProvider;
    
    updateEngineBadge('ai-builder-active-engine', data.widgetBuilderEngine, data.widgetBuilderProvider);
    updateEngineBadge('ai-widgets-active-engine', data.dynamicWidgetsEngine, data.dynamicWidgetsProvider);
    
    const geminiInput = document.getElementById('ai-env-gemini-key');
    if (geminiInput) {
      geminiInput.value = data.geminiKey || '';
      geminiInput.placeholder = data.hasGeminiKey ? '••••••••••••••• (Key Configured)' : 'Enter Gemini API Key (starts with AIzaSy...)';
    }
    
    const groqInput = document.getElementById('ai-env-groq-key');
    if (groqInput) {
      groqInput.value = data.groqKey || '';
      groqInput.placeholder = data.hasGroqKey ? '••••••••••••••• (Key Configured)' : 'Enter Groq API Key (starts with gsk_...)';
    }
    
    document.getElementById('ai-env-ollama-host').value = data.ollamaHost;
    
    savedOllamaModel = data.ollamaModel || 'llama3.2:1b';
    const modelSelect = document.getElementById('ai-env-ollama-model');
    if (modelSelect) {
      modelSelect.innerHTML = `<option value="${savedOllamaModel}">${savedOllamaModel}</option>`;
      modelSelect.value = savedOllamaModel;
    }
  } catch (err) {
    console.error("Failed to load AI Env Config:", err);
    showToast("Failed to fetch AI configuration settings", true);
  }
}

// Fetch Ollama Online status and tags list
async function fetchOllamaStatus() {
  try {
    const res = await fetch('/api/ai/ollama/status');
    if (!res.ok) throw new Error("Offline");
    const data = await res.json();
    
    const statusBadge = document.getElementById('ollama-status-indicator');
    const onlinePanel = document.getElementById('ollama-online-panel');
    const offlinePanel = document.getElementById('ollama-offline-panel');
    
    if (data.online) {
      statusBadge.innerText = 'ONLINE';
      statusBadge.className = 'ollama-status-badge online';
      
      onlinePanel.style.display = 'block';
      offlinePanel.style.display = 'none';
      
      // Dynamically compile active local model select options
      const modelSelect = document.getElementById('ai-env-ollama-model');
      if (modelSelect) {
        const currentValue = modelSelect.value || savedOllamaModel;
        
        let optionsHtml = '';
        data.models.forEach(m => {
          optionsHtml += `<option value="${m.name}">${m.name} (${m.size})</option>`;
        });
        
        // Safety check to make sure the currently selected model is in the options list
        if (currentValue && !data.models.some(m => m.name === currentValue)) {
          optionsHtml = `<option value="${currentValue}">${currentValue} (Active / Not Installed)</option>` + optionsHtml;
        }
        
        if (data.models.length === 0 && !currentValue) {
          optionsHtml = `<option value="llama3.2:1b">No models installed. Pull a model first!</option>`;
        }
        
        modelSelect.innerHTML = optionsHtml;
        modelSelect.value = currentValue;
      }
      
      // Render downloaded models list
      const modelsList = document.getElementById('ollama-models-list');
      if (modelsList) {
        let html = '';
        data.models.forEach(m => {
          html += `
            <div class="model-item">
              <span class="model-name">${m.name}</span>
              <span class="model-meta">${m.size} • ${m.parameter_size}</span>
            </div>
          `;
        });
        
        if (data.models.length === 0) {
          html = '<p class="card-help text-center mt-2">No local models downloaded yet. Use the tool below to pull models.</p>';
        }
        
        modelsList.innerHTML = html;
      }
    } else {
      statusBadge.innerText = 'OFFLINE';
      statusBadge.className = 'ollama-status-badge offline';
      
      onlinePanel.style.display = 'none';
      offlinePanel.style.display = 'block';
      
      const reasonEl = document.getElementById('ollama-offline-reason');
      if (reasonEl) {
        reasonEl.innerText = data.error || `The local Ollama server at ${data.host} could not be reached.`;
      }
    }
  } catch (err) {
    console.error("Failed to fetch Ollama status:", err);
  }
}

// Start polling Ollama status reactively
function startOllamaPolling() {
  stopOllamaPolling(); // clear any running
  
  // Instantly trigger check
  fetchOllamaStatus();
  checkOllamaPullStatus();
  
  // Status check every 10 seconds
  ollamaStatusInterval = setInterval(fetchOllamaStatus, 10000);
}

// Stop polling loops
function stopOllamaPolling() {
  if (ollamaStatusInterval) {
    clearInterval(ollamaStatusInterval);
    ollamaStatusInterval = null;
  }
  if (ollamaPullInterval) {
    clearInterval(ollamaPullInterval);
    ollamaPullInterval = null;
  }
}

// Check background model pulling progress
async function checkOllamaPullStatus() {
  try {
    const res = await fetch('/api/ai/ollama/pull-status');
    if (!res.ok) return;
    const state = await res.json();
    
    const progressWrap = document.getElementById('ollama-pull-progress-wrap');
    if (!progressWrap) return;
    
    if (state.active && state.status !== 'completed' && state.status !== 'failed') {
      progressWrap.style.display = 'block';
      document.getElementById('ollama-pull-status').innerText = `${state.status} '${state.model}'...`;
      document.getElementById('ollama-pull-percent').innerText = `${state.percent}%`;
      document.getElementById('ollama-pull-progress-bar').style.width = `${state.percent}%`;
      
      // Start aggressive polling if not already running
      if (!ollamaPullInterval) {
        ollamaPullInterval = setInterval(checkOllamaPullStatus, 1000);
      }
    } else {
      // If completed or failed
      if (state.active) {
        if (state.status === 'completed') {
          showToast(`Successfully pulled and registered model '${state.model}'!`);
          fetchOllamaStatus(); // reload downloaded list
        } else if (state.status === 'failed') {
          showToast(`Ollama pull failed: ${state.error || 'Unknown error'}`, true);
        }
        
        // Reset state by querying clear
        progressWrap.style.display = 'none';
        if (ollamaPullInterval) {
          clearInterval(ollamaPullInterval);
          ollamaPullInterval = null;
        }
      }
    }
  } catch (err) {
    console.error("Error checking Ollama pull progress:", err);
  }
}

// Initialize AI & Ollama DOM event listeners
function setupAiAdminTabListeners() {
  // Bind AI Env Form Submit
  const envForm = document.getElementById('ai-env-form');
  if (envForm) {
    envForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const submitBtn = document.getElementById('btn-save-ai-env');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "💾 Saving & Hot-Reloading...";
      }
      
      try {
        const payload = {
          widgetBuilderProvider: document.getElementById('ai-env-builder-provider').value,
          dynamicWidgetsProvider: document.getElementById('ai-env-widgets-provider').value,
          geminiKey: document.getElementById('ai-env-gemini-key').value,
          groqKey: document.getElementById('ai-env-groq-key').value,
          ollamaHost: document.getElementById('ai-env-ollama-host').value,
          ollamaModel: document.getElementById('ai-env-ollama-model').value
        };
        
        const res = await fetch('/api/ai/env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        if (data.success) {
          showToast("AI Configurations hot-reloaded successfully!");
          
          // Re-fetch global settings and AI status to align UI states!
          await fetchSettings();
          await fetchAiEnvConfig();
        } else {
          showToast(data.error || "Failed to update configurations", true);
        }
      } catch (err) {
        console.error("Failed saving env configurations:", err);
        showToast("Server connection error while saving configurations", true);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "💾 Save & Hot-Reload Configurations";
        }
      }
    });
  }
  
  // Bind Model selector toggle custom model input
  const pullSelect = document.getElementById('ollama-pull-select');
  const pullCustom = document.getElementById('ollama-pull-custom');
  if (pullSelect && pullCustom) {
    pullSelect.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        pullCustom.style.display = 'block';
        pullCustom.required = true;
      } else {
        pullCustom.style.display = 'none';
        pullCustom.required = false;
      }
    });
  }
  
  // Bind Pull Model Button
  const btnPull = document.getElementById('btn-ollama-pull');
  if (btnPull) {
    btnPull.addEventListener('click', async () => {
      const selectVal = pullSelect.value;
      const customVal = pullCustom.value.trim();
      
      let modelName = selectVal;
      if (selectVal === 'custom') {
        if (!customVal) {
          alert("Please enter a custom Ollama model name to pull!");
          return;
        }
        modelName = customVal;
      }
      
      btnPull.disabled = true;
      btnPull.innerText = "📥 Connecting...";
      
      try {
        const res = await fetch('/api/ai/ollama/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelName })
        });
        
        const reply = await res.json();
        if (reply.success) {
          showToast(`Started downloading model '${modelName}'...`);
          document.getElementById('ollama-pull-progress-wrap').style.display = 'block';
          
          // Instantly start polling pull status
          checkOllamaPullStatus();
        } else {
          showToast(reply.error || "Ollama pull request rejected", true);
        }
      } catch (err) {
        console.error("Failed pulling model:", err);
        showToast("Error connecting to server pull daemon", true);
      } finally {
        btnPull.disabled = false;
        btnPull.innerText = "📥 Pull Model";
      }
    });
  }
}
