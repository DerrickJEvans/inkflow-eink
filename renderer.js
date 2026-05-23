// renderer.js - Coordinates plugin fetching, SVG rendering, and E-Ink image processing
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Load plugin modules
const systemPlugin = require('./plugins/system');
const weatherPlugin = require('./plugins/weather');
const rssPlugin = require('./plugins/rss');
const rssTechPlugin = require('./plugins/rss_tech');
const rssUkPlugin = require('./plugins/rss_uk');
const rssWorldPlugin = require('./plugins/rss_world');
const notesPlugin = require('./plugins/notes');
const tflPlugin = require('./plugins/tfl');

const PLUGINS = {
  system: systemPlugin,
  weather: weatherPlugin,
  rss: rssPlugin,
  rss_tech: rssTechPlugin,
  rss_uk: rssUkPlugin,
  rss_world: rssWorldPlugin,
  notes: notesPlugin,
  tfl: tflPlugin
};

/**
 * Applies Floyd-Steinberg Dithering to a Grayscale Raw Buffer
 * Uses Int16Array to prevent overflow when diffusing error values
 */
const applyFloydSteinbergDither = (grayscaleBuffer, width, height) => {
  const pixelCount = width * height;
  const temp = new Int16Array(grayscaleBuffer);
  const dithered = Buffer.alloc(pixelCount);

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
  const activePlugins = device.activePlugins || ["system", "weather", "rss", "notes"];
  
  // 1. Fetch data for each active plugin
  const fetchedData = {};
  for (const pluginId of activePlugins) {
    if (PLUGINS[pluginId]) {
      try {
        fetchedData[pluginId] = await PLUGINS[pluginId].fetchData(settings[pluginId] || {});
      } catch (err) {
        console.error(`Error loading data for plugin [${pluginId}]:`, err);
        fetchedData[pluginId] = null;
      }
    }
  }

  // 2. Setup Layout Grid Coordinates based on active count
  let layoutElements = '';
  let gridLines = '';
  
  const layoutMode = device.layoutMode || 'grid';

  if (layoutMode === 'rotation') {
    // Carousel Mode: Render the current active plugin full-screen
    const currentIndex = device.currentPluginIndex || 0;
    const pId = activePlugins[currentIndex % activePlugins.length];
    if (PLUGINS[pId] && fetchedData[pId]) {
      layoutElements += `
        <g transform="translate(0, 0)">
          ${PLUGINS[pId].renderSVG(fetchedData[pId], w, h)}
        </g>
      `;
    }
  } else {
    // Grid Mode (Existing Layout Logic)
    const count = activePlugins.length;
    if (count === 1) {
      // Full screen
      const pId = activePlugins[0];
      if (PLUGINS[pId] && fetchedData[pId]) {
        layoutElements += `
          <g transform="translate(0, 0)">
            ${PLUGINS[pId].renderSVG(fetchedData[pId], w, h)}
          </g>
        `;
      }
    } else if (count === 2) {
      // Split screen side-by-side (2 columns)
      const qw = w / 2;
      activePlugins.forEach((pId, idx) => {
        if (PLUGINS[pId] && fetchedData[pId]) {
          layoutElements += `
            <g transform="translate(${idx * qw}, 0)">
              ${PLUGINS[pId].renderSVG(fetchedData[pId], qw, h)}
            </g>
          `;
        }
      });
      // Draw vertical divider
      gridLines += `<line x1="${qw}" y1="0" x2="${qw}" y2="${h}" stroke="black" stroke-width="2" />`;
    } else if (count === 3) {
      // 1 Top full row, 2 bottom columns
      const qh = h / 2;
      const qw = w / 2;

      // Top Full-width
      const p1 = activePlugins[0];
      if (PLUGINS[p1] && fetchedData[p1]) {
        layoutElements += `
          <g transform="translate(0, 0)">
            ${PLUGINS[p1].renderSVG(fetchedData[p1], w, qh)}
          </g>
        `;
      }
      // Bottom Left
      const p2 = activePlugins[1];
      if (PLUGINS[p2] && fetchedData[p2]) {
        layoutElements += `
          <g transform="translate(0, ${qh})">
            ${PLUGINS[p2].renderSVG(fetchedData[p2], qw, qh)}
          </g>
        `;
      }
      // Bottom Right
      const p3 = activePlugins[2];
      if (PLUGINS[p3] && fetchedData[p3]) {
        layoutElements += `
          <g transform="translate(${qw}, ${qh})">
            ${PLUGINS[p3].renderSVG(fetchedData[p3], qw, qh)}
          </g>
        `;
      }
      // Divider lines
      gridLines += `
        <line x1="0" y1="${qh}" x2="${w}" y2="${qh}" stroke="black" stroke-width="2" />
        <line x1="${qw}" y1="${qh}" x2="${qw}" y2="${h}" stroke="black" stroke-width="2" />
      `;
    } else {
      // default/4+ plugins: 2x2 grid (displays first 4 active)
      const qw = w / 2;
      const qh = h / 2;
      const gridMap = [
        { x: 0, y: 0 },
        { x: qw, y: 0 },
        { x: 0, y: qh },
        { x: qw, y: qh }
      ];

      activePlugins.slice(0, 4).forEach((pId, idx) => {
        if (PLUGINS[pId] && fetchedData[pId]) {
          const pos = gridMap[idx];
          layoutElements += `
            <g transform="translate(${pos.x}, ${pos.y})">
              ${PLUGINS[pId].renderSVG(fetchedData[pId], qw, qh)}
            </g>
          `;
        }
      });

      // Dividers
      gridLines += `
        <line x1="0" y1="${qh}" x2="${w}" y2="${qh}" stroke="black" stroke-width="2" />
        <line x1="${qw}" y1="0" x2="${qw}" y2="${h}" stroke="black" stroke-width="2" />
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
      
      <!-- Border Divider Lines -->
      ${gridLines}
      
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
  const dithered = applyFloydSteinbergDither(rawGrayscale, w, h);

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
  PLUGINS
};
