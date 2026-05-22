// rss.js - Parses RSS Feeds and displays top headlines
const Parser = require('rss-parser');
const parser = new Parser({
  headers: { 'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)' },
  timeout: 5000
});

module.exports = {
  id: "rss",
  name: "RSS Bulletin",
  description: "Fetches and displays headlines from custom RSS news feeds.",
  configFields: [
    { key: "url", label: "RSS Feed URL", type: "text", default: "https://news.ycombinator.com/rss" },
    { key: "limit", label: "Maximum Stories", type: "number", default: 4 }
  ],

  async fetchData(settings) {
    const feedUrl = settings.url || "https://news.ycombinator.com/rss";
    const limit = parseInt(settings.limit) || 4;

    try {
      const feed = await parser.parseURL(feedUrl);
      
      const items = feed.items.slice(0, limit).map(item => {
        return {
          title: item.title,
          source: feed.title || "News"
        };
      });

      return {
        title: feed.title || "RSS Bulletin",
        items
      };
    } catch (e) {
      console.error("Error parsing RSS feed:", e);
      return {
        title: "News Feed Offline",
        items: [
          { title: "Unable to load RSS feed. Check network connection.", source: "System" },
          { title: "Configure RSS feed URL in the control panel.", source: "System" },
          { title: "Hacker News (ycombinator.com) acts as default.", source: "System" }
        ]
      };
    }
  },

  renderSVG(data, width, height) {
    const padding = 15;
    
    // Text truncation function to fit the width
    const truncateText = (text, maxLength) => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + "...";
    };

    // Calculate maximum characters that can fit based on width
    // Approximately 7 pixels per character for font-size 11
    const maxChars = Math.floor((width - padding * 2 - 15) / 7.2);

    let listHtml = '';
    const itemHeight = 33; // spacing between feed items
    const items = data.items || [];

    items.forEach((item, idx) => {
      const yPos = 62 + idx * itemHeight;
      const cleanTitle = truncateText(item.title, maxChars);
      listHtml += `
        <!-- Item ${idx + 1} -->
        <circle cx="${padding + 4}" cy="${yPos - 4}" r="2" fill="black" />
        <text x="${padding + 14}" y="${yPos}" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">${cleanTitle}</text>
        <text x="${padding + 14}" y="${yPos + 12}" font-family="sans-serif" font-size="8.5" fill="black" opacity="0.75">${item.source}</text>
      `;
    });

    return `
      <g>
        <!-- Header -->
        <text x="${padding}" y="25" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">📰 ${data.title.toUpperCase()}</text>
        <line x1="${padding}" y1="32" x2="${width - padding}" y2="32" stroke="black" stroke-width="1.5" />
        
        <!-- Feed List -->
        ${listHtml}
      </g>
    `;
  }
};
