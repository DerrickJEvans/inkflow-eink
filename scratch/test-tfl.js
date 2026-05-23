// scratch/test-tfl.js
const tflPlugin = require('../plugins/tfl');

const run = async () => {
  console.log("Fetching TfL data...");
  try {
    const data = await tflPlugin.fetchData({});
    console.log("Successfully fetched data! Line count:", data.lines.length);
    console.log("Sample line:", data.lines[0]);
    
    console.log("\nTesting Compact Layout rendering (width=400, height=240)...");
    const compactSvg = tflPlugin.renderSVG(data, 400, 240);
    console.log("✅ Compact SVG Rendered! Size:", compactSvg.length);
    
    console.log("\nTesting Full-Screen Layout rendering (width=800, height=480)...");
    const fullSvg = tflPlugin.renderSVG(data, 800, 480);
    console.log("✅ Full SVG Rendered! Size:", fullSvg.length);
    
    console.log("\nAll tests completed successfully!");
  } catch (err) {
    console.error("❌ ERROR RUNNING TFL TEST:", err);
  }
};

run();
