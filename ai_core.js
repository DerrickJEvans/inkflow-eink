// ai_core.js - Google Gemini, Groq, and Ollama AI Core Integration for InkFlow
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
const groqKey = process.env.GROQ_API_KEY;
const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true' || process.env.OLLAMA_HOST;

let aiEngine = "none";
let genAI = null;

if (groqKey && groqKey !== 'your_groq_api_key_here') {
  aiEngine = "groq";
  console.log("   ✨ InkFlow Groq AI Service Initialized successfully! ✨");
} else if (ollamaEnabled) {
  aiEngine = "ollama";
  console.log("   ✨ InkFlow Local Ollama AI Service Initialized successfully! ✨");
} else if (apiKey && apiKey !== 'your_gemini_api_key_here') {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    aiEngine = "gemini";
    console.log("   ✨ InkFlow Gemini AI Service Initialized successfully! ✨");
  } catch (err) {
    console.error("❌ Failed to initialize Google Generative AI:", err.message);
  }
} else {
  console.warn("⚠️  [AI Core] Warning: No AI provider (Gemini, Groq, Ollama) configured in .env. Running in offline fallback mode.");
}

/**
 * Strips markdown code blocks (e.g. ```javascript ... ```) from LLM's responses
 */
const cleanGeneratedCode = (rawText) => {
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(javascript|js|json)?\n/i, '');
  cleaned = cleaned.replace(/\n```$/, '');
  return cleaned.trim();
};

/**
 * Helper delay function
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Groq completions fetcher (standard OpenAI compatibility)
 */
const generateWithGroq = async (prompt, systemInstruction = null) => {
  const modelName = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  console.log(`[AI Core] Requesting Groq API using model: ${modelName}...`);
  
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API returned ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
};

/**
 * Ollama local REST client
 */
const generateWithOllama = async (prompt, systemInstruction = null) => {
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const modelName = process.env.OLLAMA_MODEL || "llama3.2:1b";
  console.log(`[AI Core] Requesting Local Ollama instance (${ollamaHost}) using model: ${modelName}...`);

  const response = await fetch(`${ollamaHost}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelName,
      prompt: systemInstruction ? `System instructions: ${systemInstruction}\nUser request: ${prompt}` : prompt,
      stream: false,
      options: {
        temperature: 0.2
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama local request failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  return result.response;
};

/**
 * Google Gemini API generator with fallback models and retry capability
 */
const generateWithGemini = async (prompt, systemInstruction = null) => {
  const primaryModelName = "gemini-2.5-flash-lite";
  const fallbackModelName = "gemini-2.5-flash";

  const attemptCall = async (modelName) => {
    const modelOptions = { model: modelName };
    if (systemInstruction) {
      modelOptions.systemInstruction = systemInstruction;
    }
    const model = genAI.getGenerativeModel(modelOptions);
    const result = await model.generateContent(prompt);
    return result.response.text();
  };

  const attemptWithRetry = async (modelName, maxRetries = 1) => {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await attemptCall(modelName);
      } catch (err) {
        const isTemporary = 
          err.status === 503 || 
          err.status === 429 || 
          (err.message && (
            err.message.includes("503") || 
            err.message.includes("429") || 
            err.message.includes("Service Unavailable") || 
            err.message.includes("Too Many Requests") ||
            err.message.includes("high demand")
          ));
        
        if (isTemporary && attempt <= maxRetries) {
          const delay = attempt * 1500;
          console.warn(`[AI Core] Model ${modelName} failed (attempt ${attempt}/${maxRetries + 1}): ${err.message}. Retrying in ${delay}ms...`);
          await sleep(delay);
        } else {
          throw err;
        }
      }
    }
  };

  try {
    console.log(`[AI Core] Requesting Gemini using primary model: ${primaryModelName}...`);
    return await attemptWithRetry(primaryModelName, 1);
  } catch (err) {
    console.warn(`[AI Core] Primary model ${primaryModelName} exhausted. Falling back to ${fallbackModelName}. Reason: ${err.message}`);
    try {
      return await attemptWithRetry(fallbackModelName, 1);
    } catch (fallbackErr) {
      console.error(`[AI Core] Fallback model ${fallbackModelName} also failed:`, fallbackErr);
      throw err;
    }
  }
};

/**
 * Main router function
 */
const generateContentWithFallback = async (prompt, systemInstruction = null) => {
  if (aiEngine === "groq") {
    return await generateWithGroq(prompt, systemInstruction);
  }
  if (aiEngine === "ollama") {
    return await generateWithOllama(prompt, systemInstruction);
  }
  if (aiEngine === "gemini") {
    return await generateWithGemini(prompt, systemInstruction);
  }
  throw new Error("No active AI provider (Gemini, Groq, Ollama) configured in .env.");
};

/**
 * Outcome A: Generates fully compliant, hot-reloadable JavaScript plugin code based on user prompt
 */
const generatePluginCode = async (userPrompt) => {
  if (aiEngine === "none") {
    return {
      success: false,
      error: "No AI provider is configured. Please configure GEMINI_API_KEY, GROQ_API_KEY, or OLLAMA_ENABLED in your .env file."
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
  description: "Short descriptive help text. If external web APIs are used, state the provider name here.",
  configFields: [
    // If the widget uses any public API or service that requires an API key, token, or client credentials,
    // you MUST define the required fields here so that the InkFlow control panel can render input forms for them.
    // Examples:
    // { key: "apiKey", label: "OpenWeatherMap API Key", type: "text", default: "" }
    // { key: "stationCode", label: "Departure Station Code", type: "text", default: "LHR" }
  ],
  async fetchData(settings, device = {}) {
    // Perform any API calls (using fetch/https) or programmatic data generation.
    // Must return a flat JSON object with data fields.
    // IMPORTANT: If this widget requires an API key, check for its existence in settings:
    // const apiKey = settings.apiKey;
    // If missing or empty, return an object containing an error message (e.g. { error: "API Key Not Set" }) so it renders gracefully.
    // Make sure to add robust try-catch blocks and return descriptive offline/error fallbacks on error!
    return { ... };
  },
  renderSVG(data, width, height) {
    // If data.error is present, render an elegant, centered E-Ink error notice board explaining how to configure the key.
    // Must return a string containing valid SVG elements (paths, texts, rects, etc.).
    // DO NOT wrap in <svg> tags! Just return the inner XML elements.
    // Ensure all elements scale dynamically using the passed width and height parameters.
    // Use crisp sans-serif or monospace fonts, high-contrast black/white fills, and E-Ink safe borders.
    // Use a single line of title/header text and then render your data fields.
    return \`...\`
  }
};
\`\`\`

Ensure the code is modern, fully completed (no placeholders), robustly handles error conditions, and fits beautifully on both 800x480 (full screen) and 400x240 (rotation/carousel cells) dimensions. If an external API is used, ensure it is keyless or exposes configFields for keys.
`;

  try {
    const rawText = await generateContentWithFallback(
      `Generate a custom InkFlow widget based on this request: ${userPrompt}`,
      systemInstruction
    );
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
      error: `Widget generation failed: ${err.message}`
    };
  }
};

/**
 * Outcome B: Generates an elegant daily morning briefing by summarizing news and weather inputs
 */
const generateDailyBriefing = async (rssHeadlines, weatherInfo) => {
  if (aiEngine === "none") {
    return "InkFlow AI is currently running in offline fallback mode. Please configure your GEMINI_API_KEY, GROQ_API_KEY, or OLLAMA_ENABLED inside the .env file to generate your custom synthesized daily editorial briefing here!";
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
    const rawText = await generateContentWithFallback(prompt);
    return rawText.trim();
  } catch (err) {
    console.error("[AI Core] Briefing generation failed:", err);
    if (err.status === 429 || (err.message && err.message.includes("429"))) {
      return "ERROR: API rate limit exceeded. Please verify your provider account limits or switch to Groq/Ollama.";
    }
    if (err.status === 503 || (err.message && err.message.includes("503"))) {
      return "ERROR: API service is currently experiencing high demand. Retrying on next refresh.";
    }
    return "ERROR: Error generating AI briefing. Check local network connection and API key status.";
  }
};

/**
 * Outcome C: Analyzes server hardware statistics and returns expert sys-admin tips
 */
const generateSystemInsights = async (systemStatsText) => {
  if (aiEngine === "none") {
    return "InkFlow Advisor is currently offline. Configure your GEMINI_API_KEY, GROQ_API_KEY, or OLLAMA_ENABLED to receive real-time AI system recommendations, diagnostics, and proactive server tuning alerts on your dashboard!";
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
    const rawText = await generateContentWithFallback(prompt);
    return rawText.trim();
  } catch (err) {
    console.error("[AI Core] Telemetry insights failed:", err);
    if (err.status === 429 || (err.message && err.message.includes("429"))) {
      return "ERROR: API rate limit exceeded. Please verify your provider account limits or switch to Groq/Ollama.";
    }
    if (err.status === 503 || (err.message && err.message.includes("503"))) {
      return "ERROR: API service is currently experiencing high demand. Retrying on next refresh.";
    }
    return "ERROR: Unable to compile telemetry insights. Verify network configuration.";
  }
};

module.exports = {
  aiActive: () => aiEngine !== "none",
  generatePluginCode,
  generateDailyBriefing,
  generateSystemInsights
};
