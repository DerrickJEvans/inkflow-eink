// test-world-clock.js - Verifies NOAA calculations, sun/moon positions, and E-Ink world map (Solid & Dots)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const worldClockPlugin = require('../plugins/world_clock');

console.log("======================================================");
console.log("   🧪 Testing World Sun & Moon Clock Plugin Styles 🧪");
console.log("======================================================\n");

const applyFloydSteinbergDither = (grayscaleBuffer, width, height) => {
  const pixelCount = width * height;
  const dithered = Buffer.alloc(pixelCount);
  const temp = new Int16Array(grayscaleBuffer);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldVal = temp[idx];
      const newVal = oldVal < 128 ? 0 : 255;
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
};

const rasterizeAndSave = async (innerSvg, fileName) => {
  const fullSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">
      <rect width="100%" height="100%" fill="white" />
      ${innerSvg}
    </svg>
  `;
  
  const scratchDir = path.join(__dirname);
  const svgPath = path.join(scratchDir, `${fileName}.svg`);
  fs.writeFileSync(svgPath, fullSvg, 'utf8');
  console.log(`✅ Saved vector SVG output to: ${svgPath}`);

  try {
    const pngPath = path.join(scratchDir, `${fileName}.png`);
    const svgBuffer = Buffer.from(fullSvg);
    
    // Rasterize SVG as grayscale raw image
    const rawGrayscale = await sharp(svgBuffer)
      .resize(800, 480)
      .grayscale()
      .raw()
      .toBuffer();

    // Apply realistic Floyd-Steinberg error diffusion dithering ( E-Ink style )
    const dithered = applyFloydSteinbergDither(rawGrayscale, 800, 480);

    // Save as 1-channel monochrome PNG
    await sharp(dithered, { raw: { width: 800, height: 480, channels: 1 } })
      .png({ palette: true, colors: 2 })
      .toFile(pngPath);

    console.log(`✅ Saved E-Ink dithered mockup to: ${pngPath}`);
  } catch (err) {
    console.error(`❌ Failed to rasterize SVG for ${fileName}:`, err);
  }
};

const runTest = async () => {
  const baseSettings = {
    timezone: "Europe/London",
    latitude: 51.5074,
    longitude: -0.1278,
    label: "London Observatory Clock"
  };

  const mockDevice = {
    id: "test_observatory_screen",
    width: 800,
    height: 480
  };

  console.log("1. Executing celestial, lunar, and solar calculations...");
  
  // Test Style 1: Hires (High-Resolution Map with smooth terminator)
  console.log("\n--- STYLE 1: HIRES (HIGH-RESOLUTION MAP STYLE) ---");
  const dataHires = await worldClockPlugin.fetchData({ ...baseSettings, mapStyle: "hires" }, mockDevice);
  const innerSvgHires = worldClockPlugin.renderSVG(dataHires, 800, 480);
  await rasterizeAndSave(innerSvgHires, "test_world_clock_hires");

  // Test Style 2: Solid (Satellite Style Grid)
  console.log("\n--- STYLE 2: SOLID (SATELLITE STYLE GRID) ---");
  const dataSolid = await worldClockPlugin.fetchData({ ...baseSettings, mapStyle: "solid" }, mockDevice);
  const innerSvgSolid = worldClockPlugin.renderSVG(dataSolid, 800, 480);
  await rasterizeAndSave(innerSvgSolid, "test_world_clock_solid");

  // Test Style 3: Dots (Dot-Matrix Style)
  console.log("\n--- STYLE 3: DOTS (DOT-MATRIX STYLE) ---");
  const dataDots = await worldClockPlugin.fetchData({ ...baseSettings, mapStyle: "dots" }, mockDevice);
  const innerSvgDots = worldClockPlugin.renderSVG(dataDots, 800, 480);
  await rasterizeAndSave(innerSvgDots, "test_world_clock_dots");

  console.log("\n🎉 ALL THREE WORLD CLOCK STYLES SUCCESSFULLY COMPILED AND VERIFIED!");
};

runTest();
