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
  
  // Symmetrical cleanup: clear memory keys for files that no longer exist on disk
  const filePluginIds = files.filter(f => f.endsWith('.js')).map(f => f.slice(0, -3));
  Object.keys(PLUGINS).forEach(key => {
    if (!filePluginIds.includes(key)) {
      delete PLUGINS[key];
      console.log(`[Renderer] Symmetrically unloaded deleted plugin from memory: ${key}`);
    }
  });

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

  if (ditherMode === 'bayer-4' || ditherMode === 'bayer-8' || ditherMode === 'bayer') {
    const isBayer4 = ditherMode === 'bayer-4';
    if (isBayer4) {
      const bayer4 = [
        [ 0,  8,  2, 10],
        [12,  4, 14,  6],
        [ 3, 11,  1,  9],
        [15,  7, 13,  5]
      ];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const val = bayer4[y % 4][x % 4];
          const threshold = (val * 16) + 8;
          dithered[idx] = grayscaleBuffer[idx] < threshold ? 0 : 255;
        }
      }
    } else {
      const bayer8 = [
        [ 0, 48, 12, 60,  3, 51, 15, 63],
        [32, 16, 44, 28, 35, 19, 47, 31],
        [ 8, 56,  4, 52, 11, 59,  7, 55],
        [40, 24, 36, 20, 43, 27, 39, 23],
        [ 2, 50, 14, 62,  1, 49, 13, 61],
        [34, 18, 46, 30, 33, 17, 45, 29],
        [10, 58,  6, 54,  9, 57,  5, 53],
        [42, 26, 38, 22, 41, 25, 37, 21]
      ];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const val = bayer8[y % 8][x % 8];
          const threshold = (val * 4) + 2;
          dithered[idx] = grayscaleBuffer[idx] < threshold ? 0 : 255;
        }
      }
    }
    return dithered;
  }

  if (ditherMode === '4gray' || ditherMode === '4-gray') {
    const levels = [0, 128, 192, 255];
    const findNearest = (val) => {
      let nearest = 255;
      let minDiff = 999;
      for (const lvl of levels) {
        const diff = Math.abs(val - lvl);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = lvl;
        }
      }
      return nearest;
    };

    const temp = new Int16Array(grayscaleBuffer);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldVal = temp[idx];
        const newVal = findNearest(oldVal);
        dithered[idx] = newVal;
        const err = oldVal - newVal;

        if (x + 1 < width) {
          temp[idx + 1] += (err * 7) >> 4;
        }
        if (y + 1 < height) {
          if (x > 0) {
            temp[(y + 1) * width + (x - 1)] += (err * 3) >> 4;
          }
          temp[(y + 1) * width + x] += (err * 5) >> 4;
          if (x + 1 < width) {
            temp[(y + 1) * width + (x + 1)] += (err * 1) >> 4;
          }
        }
      }
    }
    return dithered;
  }

  const temp = new Int16Array(grayscaleBuffer);
  
  if (ditherMode === 'atkinson') {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldVal = temp[idx];
        const newVal = oldVal < 128 ? 0 : 255;
        dithered[idx] = newVal;
        const err = (oldVal - newVal) >> 3; // Atkinson uses 1/8 error diffusion (shift by 3)
        if (err === 0) continue;

        // Diffuse to 6 neighbors:
        // (x+1, y)
        if (x + 1 < width) {
          temp[idx + 1] += err;
        }
        // (x+2, y)
        if (x + 2 < width) {
          temp[idx + 2] += err;
        }
        if (y + 1 < height) {
          const nextRowIdx = (y + 1) * width;
          // (x-1, y+1)
          if (x > 0) {
            temp[nextRowIdx + (x - 1)] += err;
          }
          // (x, y+1)
          temp[nextRowIdx + x] += err;
          // (x+1, y+1)
          if (x + 1 < width) {
            temp[nextRowIdx + (x + 1)] += err;
          }
        }
        // (x, y+2)
        if (y + 2 < height) {
          temp[(y + 2) * width + x] += err;
        }
      }
    }
    return dithered;
  }

  // Fallback to standard Floyd-Steinberg
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
        const globalPluginSettings = settings[pluginId] || {};
        const devicePluginSettings = (device.settings && device.settings[pluginId]) || {};
        const mergedSettings = { ...globalPluginSettings, ...devicePluginSettings };
        data = await PLUGINS[pluginId].fetchData(mergedSettings, device);
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
    <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <style>
        /* Antialiasing for white text on dark background by outlining with a grey border */
        text[fill="white"], text[fill="WHITE"],
        text[fill="#fff"], text[fill="#FFF"],
        text[fill="#ffffff"], text[fill="#FFFFFF"],
        [fill="white"] text, [fill="WHITE"] text,
        [fill="#fff"] text, [fill="#FFF"] text,
        [fill="#ffffff"] text, [fill="#FFFFFF"] text,
        tspan[fill="white"], tspan[fill="WHITE"],
        tspan[fill="#fff"], tspan[fill="#FFF"],
        tspan[fill="#ffffff"], tspan[fill="#FFFFFF"] {
          stroke: #ffffff;
          stroke-width: 1px;
          paint-order: stroke fill;
        }
      </style>
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
  let svgString = await generateSVG(device, settings);

  // 2. Sharp Grayscale Rasterization (Flatten transparent SVG to white background)
  const rawGrayscale = await sharp(Buffer.from(svgString))
    .resize(w, h)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer();

  // 3. Error Diffusion Dithering
  const ditherMode = device.ditherMode || 'floyd-steinberg';
  const is4Gray = ditherMode === '4gray' || ditherMode === '4-gray';
  const dithered = applyFloydSteinbergDither(rawGrayscale, w, h, ditherMode);

  // Apply optional color inversion
  if (device.invertColors) {
    if (is4Gray) {
      for (let i = 0; i < dithered.length; i++) {
        const val = dithered[i];
        if (val === 255) dithered[i] = 0;
        else if (val === 192) dithered[i] = 128;
        else if (val === 128) dithered[i] = 192;
        else if (val === 0) dithered[i] = 255;
      }
    } else {
      for (let i = 0; i < dithered.length; i++) {
        dithered[i] = dithered[i] === 0 ? 255 : 0;
      }
    }
  }

  // 4. Export PNG
  const pngColors = is4Gray ? 4 : 2;
  const pngBuffer = await sharp(dithered, { raw: { width: w, height: h, channels: 1 } })
    .png({ palette: true, colors: pngColors })
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
  applyFloydSteinbergDither,
  PLUGINS,
  loadPlugins
};
