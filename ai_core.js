// ai_core.js - Google Gemini AI Core Integration for InkFlow
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
let aiActive = false;
let genAI = null;

if (apiKey && apiKey !== 'your_gemini_api_key_here') {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    aiActive = true;
    console.log("   ✨ InkFlow Gemini AI Service Initialized successfully! ✨");
  } catch (err) {
    console.error("❌ Failed to initialize Google Generative AI:", err.message);
  }
} else {
  console.warn("⚠️  [AI Core] Warning: GEMINI_API_KEY not configured in .env. Running in offline fallback mode.");
}

/**
 * Strips markdown code blocks (e.g. ```javascript ... ```) from Gemini's responses
 */
const cleanGeneratedCode = (rawText) => {
  let cleaned = rawText.trim();
  // Remove markdown starting backticks
  cleaned = cleaned.replace(/^```(javascript|js|json)?\n/i, '');
  // Remove markdown ending backticks
  cleaned = cleaned.replace(/\n```$/, '');
  return cleaned.trim();
};

/**
 * Outcome A: Generates fully compliant, hot-reloadable JavaScript plugin code based on user prompt
 */
const generatePluginCode = async (userPrompt) => {
  if (!aiActive || !genAI) {
    return {
      success: false,
      error: "Gemini API Key is not configured. Please add GEMINI_API_KEY to your .env file."
    };
  }

  const systemInstruction = `
You are an expert E-Ink widget developer for "InkFlow".
Your task is to build a fully compliant, self-contained, offline-safe JavaScript plugin for our Node.js server.
You must return ONLY raw, executable JavaScript code. Do not wrap it in markdown backticks, and do not include any explanatory conversational text. The response must be saved directly to a file and run immediately.

### Strict Schema Requirements:
The plugin file must export a single object:
\`\`\`javascript
module.exports = {
  id: "unique_lowercase_id", // must match filename (e.g., id: "quotes" for quotes.js)
  name: "Plugin Display Name", // readable name
  description: "Short descriptive help text.",
  configFields: [
    // optional inputs (type can be "text", "number", "select")
    // e.g. { key: "category", label: "Category", type: "text", default: "inspirational" }
  ],
  async fetchData(settings, device = {}) {
    // Perform any API calls (using fetch/https) or programmatic data generation.
    // Must return a flat JSON object with data fields.
    // Make sure to add robust try-catch blocks and return descriptive offline fallbacks on error!
    return { ... };
  },
  renderSVG(data, width, height) {
    // Must return a string containing valid SVG elements (paths, texts, rects, etc.).
    // DO NOT wrap in <svg> tags! Just return the inner XML elements.
    // Ensure all elements scale dynamically using the passed width and height parameters.
    // Use crisp sans-serif or monospace fonts, high-contrast black/white fills, and E-Ink safe borders.
    // Use a single line of title/header text and then render your data fields.
    return \`...\`;
  }
};
\`\`\`

Ensure the code is modern, fully completed (no placeholders), robustly handles error conditions, and fits beautifully on both 800x480 (full screen) and 400x240 (rotation/carousel cells) dimensions.
`;

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
      systemInstruction: systemInstruction
    });

    const result = await model.generateContent(`Generate a custom InkFlow widget based on this request: ${userPrompt}`);
    const rawText = result.response.text();
    const cleanCode = cleanGeneratedCode(rawText);

    // Basic syntax validation check
    if (!cleanCode.includes("module.exports") || !cleanCode.includes("fetchData") || !cleanCode.includes("renderSVG")) {
      throw new Error("Generated code is missing mandatory module.exports schema properties.");
    }

    // Attempt to extract the ID dynamically
    const idMatch = cleanCode.match(/id\s*:\s*["']([^"']+)["']/);
    const generatedId = idMatch ? idMatch[1] : `ai_plugin_${Date.now()}`;

    return {
      success: true,
      pluginId: generatedId,
      code: cleanCode
    };
  } catch (err) {
    console.error("[AI Core] Error generating plugin:", err);
    return {
      success: false,
      error: `Gemini generation failed: ${err.message}`
    };
  }
};

/**
 * Outcome B: Generates an elegant daily morning briefing by summarizing news and weather inputs
 */
const generateDailyBriefing = async (rssHeadlines, weatherInfo) => {
  if (!aiActive || !genAI) {
    return "InkFlow Gemini AI is currently running in offline fallback mode. Please configure your GEMINI_API_KEY inside the .env file to generate your custom synthesized daily editorial briefing here!";
  }

  const prompt = `
You are an elite print newspaper editor. You write elegant, concise, witty morning briefings for busy professionals.
Please synthesize the following real-time data inputs into a single, cohesive, engaging paragraph of exactly 2-3 sentences.
Do not use markdown formatting (like bold, bullet points, or headers). Write it as a clean, continuous paragraph.

### Raw Data Inputs:
* **RSS News Headlines:**
${rssHeadlines}

* **Weather Info:**
${weatherInfo}

Write a premium morning brief synthesizing these elements:
`;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error("[AI Core] Briefing generation failed:", err);
    return "Error generating AI briefing. Check local network connection and API key status.";
  }
};

/**
 * Outcome C: Analyzes server hardware statistics and returns expert sys-admin tips
 */
const generateSystemInsights = async (systemStatsText) => {
  if (!aiActive || !genAI) {
    return "InkFlow Advisor is currently offline. Configure your GEMINI_API_KEY to receive real-time AI system recommendations, diagnostics, and proactive server tuning alerts on your dashboard!";
  }

  const prompt = `
You are an expert system administrator monitoring a server named "InkFlow".
Inspect the following real-time hardware telemetry statistics and provide exactly 2-3 short, highly actionable bullet points containing diagnostic alerts, server performance tuning tips, or health checks.
Keep each bullet point under 12 words. Do not use bold formatting or headers.

### Hardware Telemetry:
${systemStatsText}

Write your Sys-Admin recommendations:
`;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error("[AI Core] Telemetry insights failed:", err);
    return "Unable to compile telemetry insights. Verify network configuration.";
  }
};

module.exports = {
  aiActive: () => aiActive,
  generatePluginCode,
  generateDailyBriefing,
  generateSystemInsights
};
