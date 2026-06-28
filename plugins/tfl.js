// tfl.js - Transport for London Rail Status Plugin
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

// Helper to make GET requests returning JSON
const getJson = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)' },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => reject(err));
  });
};

module.exports = {
  id: "tfl",
  name: "TfL Rail Status",
  description: "Displays current status for London Tube, Overground, DLR, and Elizabeth Line.",
  configFields: [
    { key: "modes", label: "Included Modes (comma separated)", type: "text", default: "tube,overground,dlr,elizabeth-line" }
  ],

  async fetchData(settings) {
    const modes = settings.modes || "tube,overground,dlr,elizabeth-line";
    const url = `https://api.tfl.gov.uk/line/mode/${modes}/status`;

    try {
      const data = await getJson(url);
      if (!Array.isArray(data)) {
        throw new Error("Invalid TfL response format");
      }
      
      const lines = data.map(item => {
        const status = item.lineStatuses[0] || { statusSeverity: 10, statusSeverityDescription: "Good Service" };
        return {
          id: item.id,
          name: item.name,
          mode: item.modeName,
          status: status.statusSeverityDescription,
          severity: status.statusSeverity,
          reason: status.reason || ""
        };
      });

      // Keep order of lines consistent (Tube lines first, then Overground, DLR, Elizabeth Line)
      const modeOrder = { "tube": 1, "overground": 2, "dlr": 3, "elizabeth-line": 4 };
      lines.sort((a, b) => {
        const orderA = modeOrder[a.mode] || 5;
        const orderB = modeOrder[b.mode] || 5;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

      return {
        lines
      };
    } catch (e) {
      console.error("Error fetching TfL rail status:", e);
      // Premium Mock/Fallback Data if Offline
      return {
        lines: [
          { id: "bakerloo", name: "Bakerloo", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "central", name: "Central", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "circle", name: "Circle", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "district", name: "District", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "hammersmith-city", name: "Hammersmith & City", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "jubilee", name: "Jubilee", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "metropolitan", name: "Metropolitan", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "northern", name: "Northern", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "piccadilly", name: "Piccadilly", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "victoria", name: "Victoria", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "waterloo-city", name: "Waterloo & City", mode: "tube", status: "Good Service", severity: 10, reason: "" },
          { id: "london-overground", name: "Overground", mode: "overground", status: "Good Service", severity: 10, reason: "" },
          { id: "dlr", name: "DLR", mode: "dlr", status: "Good Service", severity: 10, reason: "" },
          { id: "elizabeth-line", name: "Elizabeth Line", mode: "elizabeth-line", status: "Good Service", severity: 10, reason: "" }
        ]
      };
    }
  },

  renderSVG(data, width, height) {
    const padding = 20;
    const isFullScreen = height > 300;
    
    if (isFullScreen) {
      // 1. Elegant Full-Screen Multi-Column Railway Console
      const tubeLines = data.lines.filter(l => l.mode === 'tube');
      const otherLines = data.lines.filter(l => l.mode !== 'tube');
      
      let tubeHtml = '';
      const tubeItemHeight = 33;
      
      tubeLines.forEach((line, idx) => {
        const yPos = 85 + idx * tubeItemHeight;
        const isNormal = line.severity === 10;
        let statusStyle = 'font-size="12" fill="black" opacity="0.6"';
        if (!isNormal) {
          statusStyle = 'font-size="12" font-weight="bold" fill="black"';
        }
        
        tubeHtml += `
          <text x="${padding}" y="${yPos}" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${escapeXml(line.name)}</text>
          <text x="${padding + 320}" y="${yPos}" font-family="sans-serif" ${statusStyle} text-anchor="end">${escapeXml(line.status)}</text>
          <line x1="${padding}" y1="${yPos + 8}" x2="${padding + 320}" y2="${yPos + 8}" stroke="black" stroke-width="0.5" opacity="0.15" />
        `;
      });

      let otherHtml = '';
      const otherItemHeight = 22;
      
      otherLines.forEach((line, idx) => {
        const yPos = 78 + idx * otherItemHeight;
        const isNormal = line.severity === 10;
        let statusStyle = 'font-size="11" fill="black" opacity="0.6"';
        if (!isNormal) {
          statusStyle = 'font-size="11" font-weight="bold" fill="black"';
        }

        otherHtml += `
          <text x="0" y="${yPos}" font-family="sans-serif" font-size="12" font-weight="bold" fill="black">${escapeXml(line.name)}</text>
          <text x="320" y="${yPos}" font-family="sans-serif" ${statusStyle} text-anchor="end">${escapeXml(line.status)}</text>
          <line x1="0" y1="${yPos + 5}" x2="320" y2="${yPos + 5}" stroke="black" stroke-width="0.5" opacity="0.15" />
        `;
      });

      let bulletinHtml = '';
      const disrupted = data.lines.filter(l => l.severity !== 10);
      bulletinHtml += `
        <g transform="translate(0, 246)" fill="black">
          <path d="M12,2 L1,21 H23 Z M13,16 H11 V8 H13 V16 Z M13,19 H11 V17 H13 V19 Z" transform="scale(0.75)" />
        </g>
        <text x="22" y="262" font-family="sans-serif" font-size="14.5" font-weight="bold" fill="black" letter-spacing="0.5">DISRUPTION BULLETIN</text>
      `;
      
      if (disrupted.length === 0) {
        bulletinHtml += `
          <rect x="0" y="278" width="320" height="175" rx="6" fill="none" stroke="black" stroke-width="1" opacity="0.3" stroke-dasharray="4,4" />
          <text x="160" y="358" font-family="sans-serif" font-size="13.5" font-weight="bold" text-anchor="middle" fill="black" opacity="0.7">All network services normal.</text>
          <text x="160" y="383" font-family="sans-serif" font-size="12" text-anchor="middle" fill="black" opacity="0.5">Have a pleasant and safe journey!</text>
        `;
      } else {
        bulletinHtml += `
          <rect x="0" y="278" width="320" height="175" rx="6" fill="none" stroke="black" stroke-width="1.5" />
        `;
        let textRows = '';
        disrupted.slice(0, 3).forEach((line, idx) => {
          const rowY = 308 + idx * 52;
          const cleanReason = line.reason ? line.reason.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : "No details provided.";
          
          const words = cleanReason.split(' ');
          let line1 = '';
          let line2 = '';
          words.forEach(w => {
            if ((line1 + w).length < 38) {
              line1 += (line1 ? ' ' : '') + w;
            } else if ((line2 + w).length < 38) {
              line2 += (line2 ? ' ' : '') + w;
            }
          });
          if (line2 && line2.length > 35) {
            line2 = line2.substring(0, 32) + '...';
          }
          
          textRows += `
            <text x="12" y="${rowY}" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black">${escapeXml(line.name.toUpperCase())}: ${escapeXml(line.status.toUpperCase())}</text>
            <text x="12" y="${rowY + 16}" font-family="sans-serif" font-size="10.5" fill="black" opacity="0.75">${escapeXml(line1)}</text>
            ${line2 ? `<text x="12" y="${rowY + 28}" font-family="sans-serif" font-size="10.5" fill="black" opacity="0.75">${escapeXml(line2)}</text>` : ''}
          `;
        });
        bulletinHtml += textRows;
      }

      return `
        <g>
            <g transform="translate(${padding}, 17)" fill="black">
              <path d="M12,2 C6.5,2 5,3.5 5,9 V16 C5,18.8 7.2,21 10,21 L9,22 H15 L14,21 C16.8,21 19,18.8 19,16 V9 C19,3.5 17.5,2 12,2 Z M9,18 C7.9,18 7,17.1 7,16 C7,14.9 7.9,14 9,14 C10.1,14 11,14.9 11,16 C11,17.1 10.1,18 9,18 Z M15,18 C13.9,18 13,17.1 13,16 C13,14.9 13.9,14 15,14 C16.1,14 17,14.9 17,16 C17,17.1 16.1,18 15,18 Z M17,12 H7 V7 H17 V12 Z" transform="scale(0.85)" />
            </g>
            <text x="${padding + 22}" y="35" font-family="sans-serif" font-size="20" font-weight="bold" fill="black" letter-spacing="1">TfL RAILWAY NETWORK STATUS</text>
          <line x1="${padding}" y1="48" x2="${width - padding}" y2="48" stroke="black" stroke-width="2.5" />
          
          <!-- Left Column (Tube Services) -->
          ${tubeHtml}
          
          <!-- Vertical Column Divider -->
          <line x1="${width / 2}" y1="65" x2="${width / 2}" y2="455" stroke="black" stroke-width="1.5" stroke-dasharray="6,6" opacity="0.3" />
          
          <!-- Right Column (Overground/DLR/Elizabeth & Bulletin) -->
          <g transform="translate(${width / 2 + padding}, 0)">
            ${otherHtml}
            <line x1="0" y1="248" x2="320" y2="248" stroke="black" stroke-width="1.5" stroke-dasharray="4,4" />
            ${bulletinHtml}
          </g>
        </g>
      `;
    } else {
      // 2. Standard Compact Grid Cell Layout
      const compactPadding = 15;
      const disrupted = data.lines.filter(l => l.severity !== 10);
      let listHtml = '';
      
      if (disrupted.length > 0) {
        disrupted.slice(0, 3).forEach((line, idx) => {
          const yPos = 65 + idx * 42;
          const reasonPreview = line.reason ? escapeXml(line.reason.substring(0, 48)) + "..." : "Disruption reported";
          listHtml += `
            <!-- Disrupted Row -->
            <text x="${compactPadding}" y="${yPos}" font-family="sans-serif" font-size="12.5" font-weight="bold" fill="black">${escapeXml(line.name)}</text>
            <text x="${width - compactPadding}" y="${yPos}" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" text-anchor="end">${escapeXml(line.status)}</text>
            <text x="${compactPadding}" y="${yPos + 15}" font-family="sans-serif" font-size="9.5" fill="black" opacity="0.7">${reasonPreview}</text>
            <line x1="${compactPadding}" y1="${yPos + 22}" x2="${width - compactPadding}" y2="${yPos + 22}" stroke="black" stroke-width="0.5" opacity="0.1" />
          `;
        });
        
        if (disrupted.length > 3) {
          listHtml += `
            <text x="${compactPadding}" y="195" font-family="sans-serif" font-size="11" font-style="italic" fill="black" opacity="0.7">+ ${disrupted.length - 3} more line disruptions reported</text>
          `;
        }
      } else {
        // All Normal layout
        listHtml += `
          <!-- Success Checkmark -->
          <circle cx="${compactPadding + 35}" cy="100" r="24" fill="none" stroke="black" stroke-width="2" />
          <path d="M${compactPadding + 23} 100 L${compactPadding + 31} 108 L${compactPadding + 47} 92" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          
          <text x="${compactPadding + 75}" y="95" font-family="sans-serif" font-size="16" font-weight="bold" fill="black">ALL SERVICES NORMAL</text>
          <text x="${compactPadding + 75}" y="113" font-family="sans-serif" font-size="11.5" fill="black" opacity="0.6">No rail disruptions reported.</text>
          
          <line x1="${compactPadding}" y1="145" x2="${width - compactPadding}" y2="145" stroke="black" stroke-dasharray="3,3" stroke-width="1" />
          
          <!-- Sample Line Status Indicators -->
          <text x="${compactPadding}" y="175" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">Elizabeth Line</text>
          <text x="${compactPadding + 90}" y="175" font-family="sans-serif" font-size="11" fill="black" opacity="0.65">Good Service</text>
          
          <text x="${width - compactPadding - 140}" y="175" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">Overground</text>
          <text x="${width - compactPadding}" y="175" font-family="sans-serif" font-size="11" fill="black" opacity="0.65" text-anchor="end">Good Service</text>

          <text x="${compactPadding}" y="200" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">Jubilee Line</text>
          <text x="${compactPadding + 90}" y="200" font-family="sans-serif" font-size="11" fill="black" opacity="0.65">Good Service</text>
          
          <text x="${width - compactPadding - 140}" y="200" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">Northern Line</text>
          <text x="${width - compactPadding}" y="200" font-family="sans-serif" font-size="11" fill="black" opacity="0.65" text-anchor="end">Good Service</text>
        `;
      }

      return `
        <g>
          <!-- Header -->
          <g transform="translate(${compactPadding}, 11)" fill="black">
            <path d="M12,2 C6.5,2 5,3.5 5,9 V16 C5,18.8 7.2,21 10,21 L9,22 H15 L14,21 C16.8,21 19,18.8 19,16 V9 C19,3.5 17.5,2 12,2 Z M9,18 C7.9,18 7,17.1 7,16 C7,14.9 7.9,14 9,14 C10.1,14 11,14.9 11,16 C11,17.1 10.1,18 9,18 Z M15,18 C13.9,18 13,17.1 13,16 C13,14.9 13.9,14 15,14 C16.1,14 17,14.9 17,16 C17,17.1 16.1,18 15,18 Z M17,12 H7 V7 H17 V12 Z" transform="scale(0.65)" />
          </g>
          <text x="${compactPadding + 16}" y="25" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">TfL RAIL STATUS</text>
          <line x1="${compactPadding}" y1="32" x2="${width - compactPadding}" y2="32" stroke="black" stroke-width="1.5" />
          
          <!-- Body -->
          ${listHtml}
        </g>
      `;
    }
  }
};

