// uk_trains.js - Real-time UK Mainline Station Departures & Arrivals Board
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
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Failed to parse JSON response"));
        }
      });
    }).on('error', (err) => reject(err));
  });
};

module.exports = {
  id: "uk_trains",
  name: "UK Train Board",
  description: "Real-time departures and arrivals for UK mainline stations, styled like Liverpool Street boards.",
  configFields: [
    { key: "crs", label: "Station Code (CRS)", type: "text", default: "LST" },
    { key: "filterCrs", label: "Filter Destination Code", type: "text", default: "" },
    { key: "mode", label: "Board Mode", type: "select", default: "departures", options: ["departures", "arrivals"] },
    { key: "limit", label: "Maximum Services", type: "number", default: 6 }
  ],

  async fetchData(settings, device = {}) {
    const crs = (settings.crs || "LST").trim().toUpperCase();
    const filterCrs = (settings.filterCrs || "").trim().toUpperCase();
    const mode = settings.mode === "arrivals" ? "arrivals" : "departures";
    const filterType = mode === "arrivals" ? "from" : "to";
    const limit = parseInt(settings.limit) || 6;

    const filterCodes = filterCrs ? filterCrs.split(',').map(c => c.trim()).filter(Boolean) : [];

    try {
      let results = [];
      if (filterCodes.length <= 1) {
        let url = `https://huxley2.azurewebsites.net/${mode}/${crs}`;
        if (filterCodes.length === 1) {
          url += `/${filterType}/${filterCodes[0]}`;
        }
        url += `/${limit}`;
        const data = await getJson(url);
        results = [data];
      } else {
        const fetchPromises = filterCodes.map(code => {
          const url = `https://huxley2.azurewebsites.net/${mode}/${crs}/${filterType}/${code}/${limit}`;
          return getJson(url).catch(err => {
            console.error(`Error fetching data for filter code ${code}:`, err);
            return null;
          });
        });
        results = (await Promise.all(fetchPromises)).filter(Boolean);
      }

      if (results.length === 0) {
        throw new Error("No data returned from Huxley API");
      }

      const stationName = results[0].locationName || crs;
      
      const filterStationNames = results
        .map(r => r.filterLocationName)
        .filter(Boolean);
      
      const filterStationName = filterStationNames.length > 0 
        ? filterStationNames.join(', ') 
        : filterCrs;

      const allTrainServices = [];
      const serviceIds = new Set();
      for (const data of results) {
        const trainServices = data.trainServices || [];
        for (const s of trainServices) {
          const serviceId = s.serviceId || s.serviceID;
          if (serviceId) {
            if (!serviceIds.has(serviceId)) {
              serviceIds.add(serviceId);
              allTrainServices.push(s);
            }
          } else {
            allTrainServices.push(s);
          }
        }
      }

      allTrainServices.sort((a, b) => {
        const timeA = a.std || a.sta || "";
        const timeB = b.std || b.sta || "";
        return timeA.localeCompare(timeB);
      });

      const finalServices = allTrainServices.slice(0, limit);

      const services = finalServices.map(s => {
        const dest = s.destination && s.destination.length > 0 ? s.destination[0].locationName : "Unknown";
        const origin = s.origin && s.origin.length > 0 ? s.origin[0].locationName : "Unknown";
        const operator = s.operator || "National Rail";
        
        let statusText = s.etd || s.eta || "On time";
        if (s.isCancelled) {
          statusText = "Cancelled";
        }

        return {
          time: s.std || s.sta || "--:--",
          destination: mode === "arrivals" ? origin : dest,
          platform: s.platform || "-",
          operator: operator,
          status: statusText,
          isCancelled: s.isCancelled || false,
          delayReason: s.delayReason || null,
          cancelReason: s.cancelReason || null
        };
      });

      const alertSet = new Set();
      const alerts = [];
      for (const data of results) {
        const nrcc = data.nrccMessages || [];
        for (const msg of nrcc) {
          if (msg.value) {
            const cleanMsg = msg.value.replace(/<[^>]*>/g, '').trim();
            if (cleanMsg && !alertSet.has(cleanMsg)) {
              alertSet.add(cleanMsg);
              alerts.push(cleanMsg);
            }
          }
        }
      }

      return {
        stationName,
        crs,
        filterStationName,
        filterCrs,
        boardMode: mode,
        services,
        alerts
      };
    } catch (e) {
      console.error("Error fetching National Rail schedules:", e);
      return {
        stationName: crs,
        crs,
        boardMode: mode,
        services: [],
        alerts: ["Unable to load rail times. Check station code and connection."]
      };
    }
  },

  renderSVG(data, width, height) {
    const isFullScreen = height > 300;
    
    // Text truncation function to fit the width
    const truncateText = (text, maxLength) => {
      if (!text) return "";
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + "...";
    };

    if (isFullScreen) {
      // 1. Full screen departure board layout (e.g. 800x480)
      const headerHeight = 52;
      const padding = 20;
      
      // Draw service list rows
      let listHtml = '';
      const startY = 108;
      const rowHeight = 44;
      const maxRows = 7;
      const servicesToShow = (data.services || []).slice(0, maxRows);

      servicesToShow.forEach((s, idx) => {
        const y = startY + idx * rowHeight;
        const cleanDest = truncateText(s.destination, 26);
        const cleanOperator = truncateText(s.operator, 18);
        const cleanStatus = s.status === "On time" ? "ON TIME" : s.status.toUpperCase();
        
        let statusFill = "black";
        if (s.isCancelled) {
          statusFill = "black"; // High contrast black on E-Ink
        }

        listHtml += `
          <!-- Row ${idx + 1} -->
          <text x="${padding}" y="${y}" font-family="monospace" font-size="16" font-weight="bold" fill="black">${escapeXml(s.time)}</text>
          <text x="${padding + 90}" y="${y}" font-family="sans-serif" font-size="15" font-weight="bold" fill="black">${escapeXml(cleanDest)}</text>
          <text x="${padding + 370}" y="${y}" font-family="sans-serif" font-size="12" fill="black" opacity="0.7">${escapeXml(cleanOperator)}</text>
          
          <!-- Platform Circle/Badge -->
          <rect x="${padding + 540}" y="${y - 15}" width="34" height="22" rx="4" fill="none" stroke="black" stroke-width="1.5" />
          <text x="${padding + 557}" y="${y}" font-family="sans-serif" font-size="14" font-weight="bold" fill="black" text-anchor="middle">${escapeXml(s.platform)}</text>
          
          <!-- Status -->
          <text x="${width - padding}" y="${y}" font-family="sans-serif" font-size="14.5" font-weight="bold" fill="${statusFill}" text-anchor="end">${escapeXml(cleanStatus)}</text>
          
          <line x1="${padding}" y1="${y + 12}" x2="${width - padding}" y2="${y + 12}" stroke="black" stroke-width="0.5" stroke-dasharray="2,2" />
        `;
      });

      // If there are no services, display a clean placeholder
      if (servicesToShow.length === 0) {
        listHtml += `
          <rect x="${padding}" y="120" width="${width - padding * 2}" height="180" rx="8" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,4" />
          <text x="${width / 2}" y="200" font-family="sans-serif" font-size="16" font-weight="bold" fill="black" text-anchor="middle">No Direct Services Found</text>
          <text x="${width / 2}" y="225" font-family="sans-serif" font-size="12.5" fill="black" opacity="0.7" text-anchor="middle">Check station codes or filters in the dashboard.</text>
        `;
      }

      // ⚠️ Alert / Delay Reason Footer Box
      let footerHtml = '';
      let alertMsg = '';

      // Find first delay or cancellation reason
      const delayedService = (data.services || []).find(s => s.delayReason || s.cancelReason);
      if (delayedService) {
        alertMsg = delayedService.isCancelled 
          ? `Service to ${delayedService.destination} (${delayedService.time}) is cancelled: ${delayedService.cancelReason || 'Cancelled by operator'}`
          : `Service to ${delayedService.destination} (${delayedService.time}) is delayed: ${delayedService.delayReason}`;
      } else if (data.alerts && data.alerts.length > 0) {
        alertMsg = data.alerts[0];
      }

      if (alertMsg) {
        const cleanAlert = truncateText(alertMsg, 92);
        footerHtml = `
          <!-- Alert Banner -->
          <rect x="${padding}" y="${height - 54}" width="${width - padding * 2}" height="34" rx="4" fill="black" />
          <text x="${padding + 12}" y="${height - 32}" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="white">⚠️ ALERTS:</text>
          <text x="${padding + 82}" y="${height - 32}" font-family="sans-serif" font-size="11.5" fill="white">${escapeXml(cleanAlert)}</text>
        `;
      } else {
        // Standard branding footer
        footerHtml = `
          <text x="${padding}" y="${height - 20}" font-family="sans-serif" font-size="10.5" fill="black" opacity="0.6">Data source: National Rail Enquiries</text>
          <text x="${width - padding}" y="${height - 20}" font-family="sans-serif" font-size="10.5" fill="black" opacity="0.6" text-anchor="end">Live Board Updates</text>
        `;
      }

      const boardModeText = data.filterStationName 
        ? `${data.boardMode} to ${data.filterStationName}`
        : `${data.boardMode}`;

      return `
        <g>
          <!-- LED Split-Flap High-Contrast Header -->
          <rect x="0" y="0" width="${width}" height="${headerHeight}" fill="black" />
          <text x="${padding}" y="34" font-family="sans-serif" font-size="20" font-weight="bold" fill="white" letter-spacing="1.5">🚊 ${escapeXml(data.stationName.toUpperCase())}</text>
          <text x="${width - padding}" y="32" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="white" text-anchor="end" letter-spacing="1">${escapeXml(boardModeText.toUpperCase())}</text>
          
          <!-- Column Headers -->
          <text x="${padding}" y="76" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" letter-spacing="0.5">DEP TIME</text>
          <text x="${padding + 90}" y="76" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" letter-spacing="0.5">DESTINATION</text>
          <text x="${padding + 370}" y="76" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" letter-spacing="0.5">OPERATOR</text>
          <text x="${padding + 540}" y="76" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" letter-spacing="0.5">PLAT</text>
          <text x="${width - padding}" y="76" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" letter-spacing="0.5" text-anchor="end">STATUS</text>
          <line x1="${padding}" y1="83" x2="${width - padding}" y2="83" stroke="black" stroke-width="2.5" />
          
          <!-- Service Rows -->
          ${listHtml}
          
          <!-- Footer -->
          ${footerHtml}
        </g>
      `;
    } else {
      // 2. Compact Grid Cell Layout (e.g. 400x240)
      const headerHeight = 36;
      const padding = 12;
      
      let listHtml = '';
      const startY = 74;
      const rowHeight = 34;
      const maxRows = 4;
      const servicesToShow = (data.services || []).slice(0, maxRows);

      servicesToShow.forEach((s, idx) => {
        const y = startY + idx * rowHeight;
        const cleanDest = truncateText(s.destination, 16);
        const cleanStatus = s.status === "On time" ? "On time" : s.status;

        listHtml += `
          <!-- Row ${idx + 1} -->
          <text x="${padding}" y="${y}" font-family="monospace" font-size="12" font-weight="bold" fill="black">${escapeXml(s.time)}</text>
          <text x="${padding + 52}" y="${y}" font-family="sans-serif" font-size="12" font-weight="bold" fill="black">${escapeXml(cleanDest)}</text>
          
          <!-- Platform Circle/Badge -->
          <rect x="${padding + 195}" y="${y - 12}" width="24" height="16" rx="2" fill="none" stroke="black" stroke-width="1.2" />
          <text x="${padding + 207}" y="${y}" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="black" text-anchor="middle">${escapeXml(s.platform)}</text>
          
          <!-- Status -->
          <text x="${width - padding}" y="${y}" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" text-anchor="end">${escapeXml(cleanStatus)}</text>
          
          <line x1="${padding}" y1="${y + 8}" x2="${width - padding}" y2="${y + 8}" stroke="black" stroke-width="0.5" stroke-dasharray="1,1" />
        `;
      });

      if (servicesToShow.length === 0) {
        listHtml += `
          <text x="${width / 2}" y="130" font-family="sans-serif" font-size="12" font-weight="bold" fill="black" text-anchor="middle">No Departures Found</text>
        `;
      }

      const boardModeText = data.filterCrs 
        ? `${data.crs} ➔ ${data.filterCrs}`
        : `${data.crs} Departures`;

      return `
        <g>
          <!-- LED Split-Flap High-Contrast Header -->
          <rect x="0" y="0" width="${width}" height="${headerHeight}" fill="black" />
          <text x="${padding}" y="23" font-family="sans-serif" font-size="13.5" font-weight="bold" fill="white">🚊 ${escapeXml(data.stationName.toUpperCase())}</text>
          <text x="${width - padding}" y="22" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="white" text-anchor="end">${escapeXml(boardModeText.toUpperCase())}</text>
          
          <!-- Column Headers -->
          <text x="${padding}" y="52" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="black">DEP</text>
          <text x="${padding + 52}" y="52" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="black">DESTINATION</text>
          <text x="${padding + 195}" y="52" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="black">PL</text>
          <text x="${width - padding}" y="52" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="black" text-anchor="end">STATUS</text>
          <line x1="${padding}" y1="58" x2="${width - padding}" y2="58" stroke="black" stroke-width="1.8" />
          
          <!-- Service Rows -->
          ${listHtml}
        </g>
      `;
    }
  }
};
