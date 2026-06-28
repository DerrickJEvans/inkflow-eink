// ai_briefing.js - Daily AI Editorial Newspaper Widget for InkFlow
const fs = require('fs');
const path = require('path');
const { generateDailyBriefing } = require('../ai_core');

// Helper to escape XML special characters
const escapeXml = (unsafe) => {
  if (!unsafe) return "";
  return unsafe.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

/**
 * Standard utility to split a long paragraph of text into multiple lines for SVG rendering
 */
const wrapText = (text, maxCharsPerLine) => {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  words.forEach(word => {
    if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines;
};

module.exports = {
  id: "ai_briefing",
  name: "Daily AI Briefing",
  description: "A premium editorial morning newspaper synthesized by Google Gemini from weather and news headlines.",
  configFields: [],

  async fetchData(settings, device = {}) {
    const cacheDir = path.join(__dirname, '..', 'cache');
    const deviceId = device.id || 'default_screen';

    // Helper to read other cached data safely
    const getCachedData = (pluginId) => {
      const cachePath = path.join(cacheDir, `data_${deviceId}_${pluginId}.json`);
      if (fs.existsSync(cachePath)) {
        try {
          return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        } catch (e) {
          console.error(`[AI Briefing] Error parsing JSON for [${pluginId}]:`, e);
        }
      }
      return null;
    };

    const prevBriefingData = getCachedData('ai_briefing');
    const cooldownMs = 1.5 * 60 * 60 * 1000; // 1.5 hours cooldown in milliseconds
    const isPrevSuccessful = prevBriefingData && 
                            prevBriefingData.briefing && 
                            !prevBriefingData.briefing.startsWith("Error generating") && 
                            !prevBriefingData.briefing.startsWith("ERROR:") &&
                            prevBriefingData.statusLabel === "LIVE";
    const hasValidCache = isPrevSuccessful && 
                          prevBriefingData.timestamp && 
                          (Date.now() - prevBriefingData.timestamp < cooldownMs);

    if (hasValidCache) {
      console.log(`[AI Briefing] Cooldown active (${Math.round((cooldownMs - (Date.now() - prevBriefingData.timestamp)) / 60000)}m remaining). Serving cached daily briefing to preserve API quota.`);
      return prevBriefingData;
    }

    // 1. Gather news headlines
    let rssText = '';
    const rssData = getCachedData('rss');
    if (rssData && rssData.items && rssData.items.length > 0) {
      rssText = rssData.items.slice(0, 5).map(item => `- ${item.title} (Source: ${item.source})`).join('\n');
    } else {
      rssText = "- Global tech indices reach record high.\n- Space exploration module successfully docks with station.\n- Breakthrough in material sciences reported in international journal.";
    }

    // 2. Gather weather info
    let weatherText = '';
    const weatherData = getCachedData('weather');
    if (weatherData) {
      weatherText = `${weatherData.temp || 15}${weatherData.unit || '°C'}, ${weatherData.condition || 'Clear'}. High of ${weatherData.high || 18}${weatherData.unit || '°C'}, low of ${weatherData.low || 11}${weatherData.unit || '°C'}.`;
    } else {
      weatherText = "16°C, Mild and breezy. High of 19°C, low of 12°C. Gentle south-westerly wind.";
    }

    // 3. Generate Briefing via Gemini API
    let briefingText = "";
    try {
      briefingText = await generateDailyBriefing(rssText, weatherText);
    } catch (err) {
      console.error("[AI Briefing] Gemini API daily briefing failed:", err);
    }

    let dateStr = new Date().toLocaleDateString('en-GB', { 
      weekday: 'long', 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric' 
    });

    const isError = !briefingText || briefingText.includes("Error generating AI briefing") || briefingText.includes("Error compiling") || briefingText.startsWith("ERROR:");

    let sourceLabel = "SYNTHESIZED BY GOOGLE GEMINI AI";
    let statusLabel = "LIVE";
    if (isError) {
      if (briefingText && briefingText.includes("rate limit")) {
        sourceLabel = "CACHED BULLETIN • GEMINI RATE LIMITED";
        statusLabel = "RATE LIMITED (CACHED)";
      } else if (briefingText && briefingText.includes("high demand")) {
        sourceLabel = "CACHED BULLETIN • GEMINI OVERLOADED";
        statusLabel = "OVERLOADED (CACHED)";
      } else {
        sourceLabel = "CACHED BULLETIN • OFFLINE FALLBACK";
        statusLabel = "CACHED";
      }
    }

    // Clean prefix for raw display
    let cleanBriefingText = briefingText;
    if (isError && briefingText && briefingText.startsWith("ERROR: ")) {
      cleanBriefingText = briefingText.replace("ERROR: ", "");
    }

    if (isError && prevBriefingData && prevBriefingData.briefing && !prevBriefingData.briefing.includes("Error generating") && !prevBriefingData.briefing.includes("rate limit") && !prevBriefingData.briefing.includes("high demand")) {
      console.log("[AI Briefing] Reusing previous cached briefing due to API failure.");
      briefingText = prevBriefingData.briefing;
      dateStr = prevBriefingData.date || dateStr;
    } else {
      briefingText = cleanBriefingText || "Error generating AI briefing. Check local network connection and API key status.";
    }

    return {
      briefing: briefingText,
      date: dateStr,
      sourceLabel: sourceLabel,
      statusLabel: statusLabel,
      timestamp: Date.now()
    };
  },

  renderSVG(data, width, height) {
    const isFullScreen = width > 500;
    const padding = isFullScreen ? 35 : 15;
    
    // Geometry metrics based on screen size
    const headerSize = isFullScreen ? 23 : 13;
    const dateSize = isFullScreen ? 10.5 : 8.5;
    const textSize = isFullScreen ? 15.5 : 11;
    const lineHeight = isFullScreen ? 26 : 17;
    const maxChars = isFullScreen ? 78 : 46;

    const wrappedLines = wrapText(data.briefing || "", maxChars);

    let textHtml = '';
    const startY = isFullScreen ? 135 : 62;
    wrappedLines.forEach((line, idx) => {
      const y = startY + idx * lineHeight;
      // High-contrast print-like Georgia serif styling
      textHtml += `<text x="${padding}" y="${y}" font-family="Georgia, serif" font-size="${textSize}" fill="black" font-style="italic" opacity="0.95">${escapeXml(line)}</text>`;
    });

    if (isFullScreen) {
      return `
        <g>
          <!-- Premium Double Line Editorial Header Card -->
          <rect x="${padding}" y="20" width="${width - padding * 2}" height="78" fill="none" stroke="black" stroke-width="2.5" />
          <line x1="${padding + 6}" y1="62" x2="${width - padding - 6}" y2="62" stroke="black" stroke-width="0.8" />
          
          <!-- Header Labels -->
          <g transform="translate(${width / 2 - 10}, 12)" fill="black">
            <path d="M19,3 H5 C3.9,3 3,3.9 3,5 V19 C3,20.1 3.9,21 5,21 H19 C20.1,21 21,20.1 21,19 V5 C21,3.9 20.1,3 19,3 Z M19,5 V11 H11 V5 H19 Z M9,5 V7 H5 V5 H9 Z M5,9 H9 V11 H5 V9 Z M5,19 V13 H19 V19 H5 Z" transform="scale(0.85)" />
          </g>
          <text x="${width / 2}" y="48" font-family="Georgia, serif" font-size="${headerSize}" font-weight="bold" fill="black" text-anchor="middle" letter-spacing="1.5">THE INKFLOW DAILY BULLETIN</text>
          <text x="${width / 2}" y="73" font-family="sans-serif" font-size="${dateSize}" font-weight="bold" fill="black" opacity="0.65" text-anchor="middle" letter-spacing="2">
            ${escapeXml(data.date.toUpperCase())}  •  ${escapeXml(data.sourceLabel || "SYNTHESIZED BY GOOGLE GEMINI AI")}
          </text>
          
          <!-- Newspaper Column text -->
          ${textHtml}
          
          <!-- Editorial Footer Divider -->
          <line x1="${padding}" y1="${height - 42}" x2="${width - padding}" y2="${height - 42}" stroke="black" stroke-width="1.5" stroke-dasharray="2,3" opacity="0.5" />
          <text x="${width / 2}" y="${height - 22}" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="black" opacity="0.45" text-anchor="middle" letter-spacing="1">
            INKFLOW INTELLECTUAL BULLETIN • DIALECTIC SUMMARIES FOR PERSONAL TELEMETRY
          </text>
        </g>
      `;
    } else {
      // Carousel/Rotation compact widget card
      const subtitleText = data.statusLabel ? `${data.date.toUpperCase()} (${data.statusLabel})` : data.date.toUpperCase();
      return `
        <g>
          <g transform="translate(${padding}, 9)" fill="black">
            <path d="M19,3 H5 C3.9,3 3,3.9 3,5 V19 C3,20.1 3.9,21 5,21 H19 C20.1,21 21,20.1 21,19 V5 C21,3.9 20.1,3 19,3 Z M19,5 V11 H11 V5 H19 Z M9,5 V7 H5 V5 H9 Z M5,9 H9 V11 H5 V9 Z M5,19 V13 H19 V19 H5 Z" transform="scale(0.8)" />
          </g>
          <text x="${padding + 22}" y="25" font-family="Georgia, serif" font-size="${headerSize}" font-weight="bold" fill="black">AI DAILY BRIEFING</text>
          <line x1="${padding}" y1="32" x2="${width - padding}" y2="32" stroke="black" stroke-width="1.5" />
          <text x="${padding}" y="44" font-family="sans-serif" font-size="${dateSize}" font-weight="bold" fill="black" opacity="0.55">${escapeXml(subtitleText)}</text>
          
          <!-- Rendered Text block -->
          ${textHtml}
        </g>
      `;
    }
  }
};
