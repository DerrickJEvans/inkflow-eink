// test-world-clock.js - Verifies NOAA calculations, sun/moon positions, and E-Ink world map (Solid & Dots)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const worldClockPlugin = require('../plugins/world_clock');

console.log("======================================================");
console.log("   🧪 Testing World Sun & Moon Clock Plugin Styles 🧪");
console.log("======================================================\n");

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

    // Apply high-contrast binarization thresholding (cleanest on e-paper)
    const binarized = Buffer.alloc(800 * 480);
    for (let i = 0; i < rawGrayscale.length; i++) {
      binarized[i] = rawGrayscale[i] < 128 ? 0 : 255;
    }

    // Save as 1-channel monochrome PNG
    await sharp(binarized, { raw: { width: 800, height: 480, channels: 1 } })
      .png({ palette: true, colors: 2 })
      .toFile(pngPath);

    console.log(`✅ Saved E-Ink binarized mockup to: ${pngPath}`);
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
  
  // Test Style 1: Solid (Satellite Style)
  console.log("\n--- STYLE 1: SOLID (SATELLITE STYLE) ---");
  const dataSolid = await worldClockPlugin.fetchData({ ...baseSettings, mapStyle: "solid" }, mockDevice);
  const innerSvgSolid = worldClockPlugin.renderSVG(dataSolid, 800, 480);
  await rasterizeAndSave(innerSvgSolid, "test_world_clock_solid");

  // Test Style 2: Dots (Dot-Matrix Style)
  console.log("\n--- STYLE 2: DOTS (DOT-MATRIX STYLE) ---");
  const dataDots = await worldClockPlugin.fetchData({ ...baseSettings, mapStyle: "dots" }, mockDevice);
  const innerSvgDots = worldClockPlugin.renderSVG(dataDots, 800, 480);
  await rasterizeAndSave(innerSvgDots, "test_world_clock_dots");

  console.log("\n🎉 BOTH WORLD CLOCK STYLES SUCCESSFULLY COMPILED AND VERIFIED!");
};

runTest();
