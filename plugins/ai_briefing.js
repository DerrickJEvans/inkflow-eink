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
    const briefingText = await generateDailyBriefing(rssText, weatherText);
    const dateStr = new Date().toLocaleDateString('en-GB', { 
      weekday: 'long', 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric' 
    });

    return {
      briefing: briefingText,
      date: dateStr
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
          <text x="${width / 2}" y="48" font-family="Georgia, serif" font-size="${headerSize}" font-weight="bold" fill="black" text-anchor="middle" letter-spacing="1.5">🗞️ THE INKFLOW DAILY BULLETIN</text>
          <text x="${width / 2}" y="73" font-family="sans-serif" font-size="${dateSize}" font-weight="bold" fill="black" opacity="0.65" text-anchor="middle" letter-spacing="2">
            ${escapeXml(data.date.toUpperCase())}  •  SYNTHESIZED BY GOOGLE GEMINI AI
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
      return `
        <g>
          <text x="${padding}" y="25" font-family="Georgia, serif" font-size="${headerSize}" font-weight="bold" fill="black">🗞️ AI DAILY BRIEFING</text>
          <line x1="${padding}" y1="32" x2="${width - padding}" y2="32" stroke="black" stroke-width="1.5" />
          <text x="${padding}" y="44" font-family="sans-serif" font-size="${dateSize}" font-weight="bold" fill="black" opacity="0.55">${escapeXml(data.date.toUpperCase())}</text>
          
          <!-- Rendered Text block -->
          ${textHtml}
        </g>
      `;
    }
  }
};
