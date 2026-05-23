// scratch/test-renderer-tfl.js
const { renderDeviceImage } = require('../renderer');

const device = {
  id: "test_tfl_device",
  name: "TfL Screen",
  width: 800,
  height: 480,
  refreshRate: 1800,
  activePlugins: ["tfl"],
  layoutMode: "grid"
};

const settings = {
  tfl: {
    modes: "tube,overground,dlr,elizabeth-line"
  }
};

const run = async () => {
  console.log("Starting full TfL device render simulation...");
  try {
    const rendered = await renderDeviceImage(device, settings);
    console.log("✅ Successfully rendered TfL screen image buffers!");
    console.log("SVG size:", rendered.svg.length);
    console.log("PNG size:", rendered.png.length);
    console.log("RAW size:", rendered.raw.length);
    
    // Save output files
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(path.join(__dirname, 'test_tfl_output.svg'), rendered.svg);
    fs.writeFileSync(path.join(__dirname, 'test_tfl_output.png'), rendered.png);
    console.log("Saved render files to scratch/test_tfl_output.svg and .png");
  } catch (err) {
    console.error("❌ RENDER FAILURE:", err);
  }
};

run();
