// xkcd.js - Displays latest or random XKCD comics on E-Ink screens
const Parser = require('rss-parser');
const parser = new Parser({
  headers: { 'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)' },
  timeout: 5000
});
const https = require('https');

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

// Helper to make GET requests returning JSON or raw data
const getJson = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)' },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
};

// Helper to download image as Base64 data URL
const fetchImageBase64 = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 6000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch image: status ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const mimeType = res.headers['content-type'] || 'image/png';
        const base64 = buffer.toString('base64');
        resolve(`data:${mimeType};base64,${base64}`);
      });
    }).on('error', reject);
  });
};

module.exports = {
  id: "xkcd",
  name: "XKCD Comics",
  description: "Displays the latest or a random XKCD comic strip cleanly scaled for your E-Ink display.",
  configFields: [
    { key: "mode", label: "Comic Mode", type: "select", default: "latest", options: ["latest", "sequential", "random"] }
  ],

  async fetchData(settings, device = {}) {
    const mode = settings.mode || "latest";

    try {
      let title = "XKCD Comic";
      let imgUrl = "";
      let hoverText = "";
      let comicNum = 0;

      if (mode === "random") {
        // 1. Fetch latest comic info to discover max index
        const latestInfo = await getJson("https://xkcd.com/info.0.json");
        const maxNum = latestInfo.num || 3000;
        
        // 2. Generate random index (avoiding the famous 404 comic)
        let randNum = 404;
        while (randNum === 404) {
          randNum = Math.floor(Math.random() * maxNum) + 1;
        }

        // 3. Fetch random comic details
        const randInfo = await getJson(`https://xkcd.com/${randNum}/info.0.json`);
        title = randInfo.title || `Comic #${randNum}`;
        imgUrl = randInfo.img || "";
        hoverText = randInfo.alt || "";
        comicNum = randNum;
      } else {
        // Fetch from RSS Feed
        const feed = await parser.parseURL("https://xkcd.com/rss.xml");
        if (!feed.items || feed.items.length === 0) {
          throw new Error("Empty RSS feed");
        }

        let selectIdx = 0;
        if (mode === "sequential") {
          const currentIdx = parseInt(device.currentXkcdIndex) || 0;
          selectIdx = currentIdx % feed.items.length;
          
          // Increment index for the next refresh cycle
          device.currentXkcdIndex = (selectIdx + 1) % feed.items.length;
        }

        const item = feed.items[selectIdx];
        title = item.title || "XKCD Comic";
        
        // Extract image URL and hover text from HTML content
        const content = item.content || "";
        const imgRegex = /<img[^>]+src=["']([^"']+)["']/i;
        const hoverRegex = /title=["']([^"']+)["']/i;
        
        const imgMatch = content.match(imgRegex);
        const hoverMatch = content.match(hoverRegex);
        
        imgUrl = imgMatch ? imgMatch[1] : "";
        hoverText = hoverMatch ? hoverMatch[1] : "";
        
        // Try parsing comic number from link, e.g. https://xkcd.com/3249/
        const numMatch = item.link ? item.link.match(/xkcd\.com\/(\d+)/) : null;
        comicNum = numMatch ? parseInt(numMatch[1]) : 0;
      }

      if (!imgUrl) {
        throw new Error("Could not parse image URL");
      }

      // Download the image buffer as Base64 data URL
      console.log(`[XKCD] Downloading comic #${comicNum} from ${imgUrl}...`);
      const base64Img = await fetchImageBase64(imgUrl);

      return {
        title,
        imgUrl,
        hoverText,
        base64Img,
        num: comicNum,
        mode
      };
    } catch (e) {
      console.error("Error fetching XKCD comic:", e);
      return {
        title: "XKCD Offline",
        imgUrl: "",
        hoverText: "Unable to load comic strip. Check connection or settings.",
        base64Img: "",
        num: 0,
        mode
      };
    }
  },

  renderSVG(data, width, height) {
    const isFullScreen = height > 300;
    
    // Dynamic text wrapper helper
    const renderWrappedText = (text, startX, startY, lineHeight, maxCharsPerLine) => {
      if (!text) return "";
      const words = text.split(' ');
      let lines = [];
      let currentLine = '';
      
      words.forEach(word => {
        if ((currentLine + word).length > maxCharsPerLine) {
          lines.push(currentLine.trim());
          currentLine = word + ' ';
        } else {
          currentLine += word + ' ';
        }
      });
      if (currentLine) {
        lines.push(currentLine.trim());
      }
      
      return lines.map((line, idx) => {
        return `<text x="${startX}" y="${startY + idx * lineHeight}" font-family="sans-serif" font-size="11.5" font-style="italic" fill="black" text-anchor="middle">"${escapeXml(line)}"</text>`;
      }).join('\n');
    };

    if (isFullScreen) {
      // 1. Full screen layout (800x480)
      const padding = 20;
      const headerHeight = 42;
      const displayTitle = data.num > 0 ? `${data.title} (#${data.num})` : data.title;
      
      let comicElement = '';
      if (data.base64Img) {
        comicElement = `<image x="${padding}" y="${headerHeight + 16}" width="${width - padding * 2}" height="320" href="${data.base64Img}" preserveAspectRatio="xMidYMid meet" />`;
      } else {
        comicElement = `
          <rect x="${padding}" y="58" width="${width - padding * 2}" height="320" rx="8" fill="none" stroke="black" stroke-width="1.5" stroke-dasharray="4,4" />
          <text x="${width / 2}" y="210" font-family="sans-serif" font-size="16" font-weight="bold" fill="black" text-anchor="middle">Comic Unavailable</text>
        `;
      }

      return `
        <g>
          <!-- Premium LED Header -->
          <rect x="${padding}" y="13" width="16" height="16" rx="3" fill="none" stroke="black" stroke-width="2.5" />
          <rect x="${padding + 4}" y="17" width="8" height="8" rx="1.5" fill="none" stroke="black" stroke-width="1.5" />
          <text x="${padding + 24}" y="27" font-family="sans-serif" font-size="16" font-weight="bold" fill="black">XKCD: ${escapeXml(displayTitle.toUpperCase())}</text>
          <text x="${width - padding}" y="25" font-family="sans-serif" font-size="11" fill="black" opacity="0.8" text-anchor="end" letter-spacing="0.5">${escapeXml(data.mode.toUpperCase())}</text>
          <line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="black" stroke-width="2" />
          
          <!-- Embedded scaled comic image -->
          ${comicElement}
          
          <!-- Bottom Alt/Hover Text Section -->
          <line x1="${padding}" y1="395" x2="${width - padding}" y2="395" stroke="black" stroke-width="1.5" />
          ${renderWrappedText(data.hoverText, width / 2, 416, 18, 92)}
          
          <!-- Bezel Screen Border -->
          <rect width="100%" height="100%" fill="none" stroke="black" stroke-width="3" />
        </g>
      `;
    } else {
      // 2. Compact Grid Layout (400x240)
      const padding = 12;
      const headerHeight = 32;
      const displayTitle = data.num > 0 ? `${data.title} (#${data.num})` : data.title;
      
      let comicElement = '';
      if (data.base64Img) {
        comicElement = `<image x="${padding}" y="${headerHeight + 10}" width="${width - padding * 2}" height="182" href="${data.base64Img}" preserveAspectRatio="xMidYMid meet" />`;
      } else {
        comicElement = `<text x="${width / 2}" y="130" font-family="sans-serif" font-size="12" font-weight="bold" fill="black" text-anchor="middle">Comic Offline</text>`;
      }

      return `
        <g>
          <!-- Premium LED Header -->
          <rect x="${padding}" y="10" width="12" height="12" rx="2" fill="none" stroke="black" stroke-width="2" />
          <rect x="${padding + 3}" y="13" width="6" height="6" rx="1" fill="none" stroke="black" stroke-width="1.2" />
          <text x="${padding + 18}" y="21" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black">XKCD: ${escapeXml(displayTitle.toUpperCase())}</text>
          <line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="black" stroke-width="1.5" />
          
          <!-- Comic -->
          ${comicElement}
        </g>
      `;
    }
  }
};
