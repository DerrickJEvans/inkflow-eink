// renderer.js - Coordinates plugin fetching, SVG rendering, and E-Ink image processing
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PLUGINS = {};

/**
 * Dynamically scans the plugins folder and loads all compliant modules.
 * Clears require caches to allow hot-reloading on-the-fly!
 */
const loadPlugins = () => {
  const pluginsDir = path.join(__dirname, 'plugins');
  if (!fs.existsSync(pluginsDir)) return;
  
  const files = fs.readdirSync(pluginsDir);
  files.forEach(file => {
    if (file.endsWith('.js')) {
      const filePath = path.join(pluginsDir, file);
      // Clear require cache to reload fresh code
      delete require.cache[require.resolve(filePath)];
      try {
        const plugin = require(filePath);
        if (plugin.id && typeof plugin.fetchData === 'function' && typeof plugin.renderSVG === 'function') {
          PLUGINS[plugin.id] = plugin;
        }
      } catch (err) {
        console.error(`[Renderer] Failed to dynamically load plugin from file [${file}]:`, err);
      }
    }
  });
  console.log(`[Renderer] Dynamically loaded ${Object.keys(PLUGINS).length} active plugins.`);
};

// Initial sync load at startup
loadPlugins();

const CACHE_DIR = path.join(__dirname, 'cache');
const getCachePath = (deviceId, pluginId) => {
  return path.join(CACHE_DIR, `data_${deviceId}_${pluginId}.json`);
};

/**
 * Applies Floyd-Steinberg Dithering to a Grayscale Raw Buffer
 * Uses Int16Array to prevent overflow when diffusing error values
 */
const applyFloydSteinbergDither = (grayscaleBuffer, width, height, ditherMode = 'floyd-steinberg') => {
  const pixelCount = width * height;
  const dithered = Buffer.alloc(pixelCount);

  if (ditherMode === 'threshold') {
    for (let i = 0; i < pixelCount; i++) {
      dithered[i] = grayscaleBuffer[i] < 128 ? 0 : 255;
    }
    return dithered;
  }

  const temp = new Int16Array(grayscaleBuffer);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldVal = temp[idx];
      // Threshold to black (0) or white (255)
      const newVal = oldVal < 128 ? 0 : 255;
      dithered[idx] = newVal;
      const err = oldVal - newVal;

      // Diffuse the quantization error to neighboring pixels
      // Right neighbor
      if (x + 1 < width) {
        temp[idx + 1] += (err * 7) >> 4;
      }
      if (y + 1 < height) {
        // Bottom-left neighbor
        if (x > 0) {
          temp[(y + 1) * width + (x - 1)] += (err * 3) >> 4;
        }
        // Bottom neighbor
        temp[(y + 1) * width + x] += (err * 5) >> 4;
        // Bottom-right neighbor
        if (x + 1 < width) {
          temp[(y + 1) * width + (x + 1)] += (err * 1) >> 4;
        }
      }
    }
  }
  return dithered;
};

/**
 * Converts a dithered monochrome buffer (0/255) into a raw 1-bit byte array
 * 8 pixels per byte, aligned horizontally, MSB-first.
 * 1 represents white (e-ink background), 0 represents black (e-ink ink).
 */
const packToRaw1Bit = (ditheredBuffer, width, height) => {
  const byteCount = Math.ceil((width * height) / 8);
  const packed = Buffer.alloc(byteCount);

  for (let i = 0; i < ditheredBuffer.length; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = 7 - (i % 8); // MSB-first
    // EPD controllers use 1 for white, 0 for black
    const isWhite = ditheredBuffer[i] > 127;
    if (isWhite) {
      packed[byteIdx] |= (1 << bitIdx);
    }
  }
  return packed;
};

/**
 * Orchestrates plugin data collection and SVG assembly
 */
const generateSVG = async (device, settings) => {
  const w = device.width || 800;
  const h = device.height || 480;
  const layoutMode = device.layoutMode || 'grid';

  // Resolve active plugins list, filtering out any invalid/legacy/deleted ones safely
  const activePlugins = (device.activePlugins || ["system", "weather", "rss", "notes"])
    .filter(pId => PLUGINS[pId]);

  // 1. Fetch data only for the active plugin in rotation mode, or all plugins in grid mode
  let pluginsToFetch = [];
  if (layoutMode === 'rotation' && activePlugins.length > 0) {
    const currentIndex = device.currentPluginIndex || 0;
    const currentPlugin = activePlugins[currentIndex % activePlugins.length];
    if (currentPlugin) {
      pluginsToFetch = [currentPlugin];
    }
  } else {
    pluginsToFetch = activePlugins;
  }

  const fetchedData = {};
  for (const pluginId of pluginsToFetch) {
    try {
      let data = null;
      const cacheFile = getCachePath(device.id, pluginId);
      if (fs.existsSync(cacheFile)) {
        try {
          data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } catch (e) {
          console.error(`Error reading cache for plugin [${pluginId}]:`, e);
        }
      }
      if (!data) {
        console.log(`[Renderer] Cache miss for [${pluginId}] on device [${device.id}]. Fetching on-the-fly...`);
        data = await PLUGINS[pluginId].fetchData(settings[pluginId] || {}, device);
      }
      fetchedData[pluginId] = data;
    } catch (err) {
      console.error(`Error loading data for plugin [${pluginId}]:`, err);
      fetchedData[pluginId] = null;
    }
  }

  // Render the current active plugin full-screen in Carousel Mode
  let layoutElements = '';
  if (activePlugins.length > 0) {
    const currentIndex = device.currentPluginIndex || 0;
    const pId = activePlugins[currentIndex % activePlugins.length];
    if (pId && PLUGINS[pId] && fetchedData[pId]) {
      layoutElements += `
        <g transform="translate(0, 0)">
          ${PLUGINS[pId].renderSVG(fetchedData[pId], w, h)}
        </g>
      `;
    }
  }

  // Assemble full SVG document
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <!-- Crisp white background for e-ink contrast -->
      <rect width="100%" height="100%" fill="white" />
      
      <!-- Injected Plugin Content -->
      ${layoutElements}
      
      <!-- Subtle Screen Outer Border -->
      <rect width="100%" height="100%" fill="none" stroke="black" stroke-width="3" />
    </svg>
  `;
};

/**
 * Main render function. Generates both PNG and Raw formats for a device.
 */
const renderDeviceImage = async (device, settings) => {
  const w = device.width || 800;
  const h = device.height || 480;

  // 1. Create the scalable vector graphic
  const svgString = await generateSVG(device, settings);

  // 2. Sharp Grayscale Rasterization
  const rawGrayscale = await sharp(Buffer.from(svgString))
    .resize(w, h)
    .grayscale()
    .raw()
    .toBuffer();

  // 3. Error Diffusion Dithering
  const ditherMode = device.ditherMode || 'floyd-steinberg';
  const dithered = applyFloydSteinbergDither(rawGrayscale, w, h, ditherMode);

  // 4. Export PNG
  const pngBuffer = await sharp(dithered, { raw: { width: w, height: h, channels: 1 } })
    .png({ palette: true, colors: 2 })
    .toBuffer();

  // 5. Export Raw 1-Bit Horizontal Bit-Packed Buffer
  const raw1BitBuffer = packToRaw1Bit(dithered, w, h);

  return {
    svg: svgString,
    png: pngBuffer,
    raw: raw1BitBuffer
  };
};

module.exports = {
  renderDeviceImage,
  PLUGINS,
  loadPlugins
};
