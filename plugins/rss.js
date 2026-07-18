// rss.js - Parses RSS Feeds and displays top headlines
const Parser = require('rss-parser');
const parser = new Parser({
  headers: { 'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)' },
  timeout: 5000,
  requestOptions: {
    rejectUnauthorized: false
  }
});

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

const PRESETS = {
  bbc_tech: {
    title: "BBC Tech News",
    url: "https://feeds.bbci.co.uk/news/technology/rss.xml"
  },
  bbc_uk: {
    title: "BBC UK News",
    url: "https://feeds.bbci.co.uk/news/uk/rss.xml"
  },
  bbc_world: {
    title: "BBC World News",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml"
  },
  hn: {
    title: "Hacker News",
    url: "https://news.ycombinator.com/rss"
  },
  nyt: {
    title: "NYT Homepage",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
  },
  cnn: {
    title: "CNN Top Stories",
    url: "http://rss.cnn.com/rss/cnn_topstories.rss"
  }
};

module.exports = {
  id: "rss",
  name: "RSS Bulletin",
  description: "Fetches and displays headlines from preset or custom RSS news feeds.",
  configFields: [
    { key: "url", label: "RSS Feed URL", type: "text", default: "https://news.ycombinator.com/rss" },
    { key: "limit", label: "Maximum Stories", type: "number", default: 4 }
  ],

  async fetchData(settings, device = {}) {
    const limit = parseInt(settings.limit) || 10;

    // Resolve which feeds are enabled from configuration settings
    let feedsToUse = [];
    if (settings.enabledFeeds && Array.isArray(settings.enabledFeeds) && settings.enabledFeeds.length > 0) {
      feedsToUse = settings.enabledFeeds;
    } else {
      // Backward compatibility and default
      feedsToUse = ["custom"];
    }

    // Resolve active sequence index
    let currentIndex = parseInt(device.currentRssFeedIndex) || 0;
    if (currentIndex < 0 || currentIndex >= feedsToUse.length) {
      currentIndex = 0;
    }

    const currentFeedId = feedsToUse[currentIndex];
    let feedUrl = "https://news.ycombinator.com/rss";
    let feedDisplayName = "RSS Bulletin";

    if (currentFeedId === "custom") {
      feedUrl = settings.customUrl || settings.url || "https://news.ycombinator.com/rss";
      feedDisplayName = "Custom RSS Feed";
    } else if (PRESETS[currentFeedId]) {
      feedUrl = PRESETS[currentFeedId].url;
      feedDisplayName = PRESETS[currentFeedId].title;
    }

    try {
      const feed = await parser.parseURL(feedUrl);
      
      const items = feed.items.slice(0, limit).map(item => {
        return {
          title: item.title,
          source: feed.title || feedDisplayName
        };
      });

      // Increment rotation index for the NEXT refresh cycle if multiple feeds are enabled
      if (feedsToUse.length > 1) {
        device.currentRssFeedIndex = (currentIndex + 1) % feedsToUse.length;
      } else {
        device.currentRssFeedIndex = 0;
      }

      return {
        title: feed.title || feedDisplayName,
        items
      };
    } catch (e) {
      console.error(`Error parsing RSS feed (${feedUrl}):`, e);

      // Still increment index on failure to prevent getting permanently stuck on an offline source
      if (feedsToUse.length > 1) {
        device.currentRssFeedIndex = (currentIndex + 1) % feedsToUse.length;
      }

      return {
        title: feedDisplayName + " Offline",
        items: [
          { title: `Unable to load RSS feed from ${feedDisplayName}.`, source: "System" },
          { title: "Check your internet connection or source URL.", source: "System" }
        ]
      };
    }
  },

  renderSVG(data, width, height) {
    const padding = 20;
    const isFullScreen = height > 300;
    
    // Text truncation function to fit the width
    const truncateText = (text, maxLength) => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + "...";
    };

    if (isFullScreen) {
      // Full screen RSS Dashboard: elegant large typography, showing up to 8 items
      const maxChars = Math.floor((width - padding * 2 - 25) / 9.5);
      let listHtml = '';
      const itemHeight = 45; // spacious layout height
      const items = (data.items || []).slice(0, 8);

      items.forEach((item, idx) => {
        const yPos = 85 + idx * itemHeight;
        const cleanTitle = truncateText(item.title, maxChars);
        listHtml += `
          <!-- Item ${idx + 1} -->
          <circle cx="${padding + 6}" cy="${yPos - 6}" r="3.5" fill="black" />
          <text x="${padding + 20}" y="${yPos}" font-family="sans-serif" font-size="14.5" font-weight="bold" fill="black">${escapeXml(cleanTitle)}</text>
          <text x="${padding + 20}" y="${yPos + 18}" font-family="sans-serif" font-size="11" fill="black" opacity="0.7">${escapeXml(item.source)}</text>
        `;
      });

      return `
        <g>
          <!-- Header -->
          <rect x="0" y="0" width="${width}" height="52" fill="black" />
          <g transform="translate(${padding}, 17)" fill="white">
            <path d="M19,3 H5 C3.9,3 3,3.9 3,5 V19 C3,20.1 3.9,21 5,21 H19 C20.1,21 21,20.1 21,19 V5 C21,3.9 20.1,3 19,3 Z M19,5 V11 H11 V5 H19 Z M9,5 V7 H5 V5 H9 Z M5,9 H9 V11 H5 V9 Z M5,19 V13 H19 V19 H5 Z" transform="scale(0.85)" />
          </g>
          <text x="${padding + 22}" y="35" font-family="sans-serif" font-size="20" font-weight="bold" fill="white" letter-spacing="1">${escapeXml(data.title.toUpperCase())}</text>
          
          <!-- Feed List -->
          ${listHtml}
        </g>
      `;
    } else {
      // Standard compact grid cell layout
      const compactPadding = 15;
      const maxChars = Math.floor((width - compactPadding * 2 - 15) / 7.2);
      let listHtml = '';
      const itemHeight = 33; // spacing between feed items
      const items = (data.items || []).slice(0, 4);

      items.forEach((item, idx) => {
        const yPos = 62 + idx * itemHeight;
        const cleanTitle = truncateText(item.title, maxChars);
        listHtml += `
          <!-- Item ${idx + 1} -->
          <circle cx="${compactPadding + 4}" cy="${yPos - 4}" r="2" fill="black" />
          <text x="${compactPadding + 14}" y="${yPos}" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">${escapeXml(cleanTitle)}</text>
          <text x="${compactPadding + 14}" y="${yPos + 12}" font-family="sans-serif" font-size="8.5" fill="black" opacity="0.75">${escapeXml(item.source)}</text>
        `;
      });

      return `
        <g>
          <!-- Header -->
          <rect x="0" y="0" width="${width}" height="32" fill="black" />
          <g transform="translate(${compactPadding}, 11)" fill="white">
            <path d="M19,3 H5 C3.9,3 3,3.9 3,5 V19 C3,20.1 3.9,21 5,21 H19 C20.1,21 21,20.1 21,19 V5 C21,3.9 20.1,3 19,3 Z M19,5 V11 H11 V5 H19 Z M9,5 V7 H5 V5 H9 Z M5,9 H9 V11 H5 V9 Z M5,19 V13 H19 V19 H5 Z" transform="scale(0.65)" />
          </g>
          <text x="${compactPadding + 16}" y="25" font-family="sans-serif" font-size="14" font-weight="bold" fill="white">${escapeXml(data.title.toUpperCase())}</text>
          
          <!-- Feed List -->
          ${listHtml}
        </g>
      `;
    }
  }
};
