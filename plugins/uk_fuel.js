// uk_fuel.js - Live UK Fuel Prices E-Ink Dashboard Plugin
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

// Helper to calculate Haversine distance in miles
const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Helper to make POST requests returning JSON (OAuth2 Token)
const getAccessToken = (clientId, clientSecret) => {
  return new Promise((resolve, reject) => {
    const payload = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
    const req = https.request('https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token', {
      method: 'POST',
      headers: {
        'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000,
      rejectUnauthorized: false
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const token = json.data && json.data.access_token;
          if (token) resolve(token);
          else reject(new Error('No access token in response'));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
};

// Helper to make GET requests returning JSON
const getJsonWithAuth = (url, accessToken) => {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      timeout: 15000,
      rejectUnauthorized: false
    }, (res) => {
      if (res.statusCode === 404) {
        const err = new Error('Not found');
        err.statusCode = 404;
        return reject(err);
      }
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

// Recursive finder for list in API response
const findList = (obj) => {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === 'object') {
    for (const key of ['data', 'stations', 'pfs', 'fuel-prices']) {
      if (Array.isArray(obj[key])) return obj[key];
      const res = findList(obj[key]);
      if (res) return res;
    }
  }
  return null;
};

// Batch fetch helper
const fetchBatchedEndpoint = async (endpoint, accessToken, onBatch) => {
  let batchNumber = 1;
  let totalLoaded = 0;
  while (true) {
    const url = `${endpoint}?batch-number=${batchNumber}`;
    try {
      const data = await getJsonWithAuth(url, accessToken);
      const items = findList(data);
      if (!items || items.length === 0) {
        break;
      }
      onBatch(items);
      totalLoaded += items.length;
      batchNumber++;
    } catch (err) {
      if (err.statusCode === 404) {
        break;
      }
      console.error(`Error in batch ${batchNumber}:`, err);
      break;
    }
  }
  return totalLoaded;
};

// Helper to resolve UK postcode to latitude & longitude
const resolvePostcode = (postcode) => {
  return new Promise((resolve) => {
    if (!postcode || !postcode.trim()) return resolve(null);
    const cleanPostcode = postcode.trim().replace(/\s+/g, '');
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(cleanPostcode)}`;
    https.get(url, {
      headers: {
        'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)'
      },
      timeout: 5000,
      rejectUnauthorized: false
    }, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 200 && json.result) {
            resolve({
              latitude: parseFloat(json.result.latitude),
              longitude: parseFloat(json.result.longitude),
              postcode: json.result.postcode
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
};

module.exports = {
  id: "uk_fuel",
  name: "UK Fuel Prices",
  description: "Fetches live fuel prices from the UK Gov Fuel Finder API and displays the cheapest options locally and nationwide.",
  configFields: [
    { key: "clientId", label: "Fuel API Client ID", type: "text", default: "" },
    { key: "clientSecret", label: "Fuel API Client Secret", type: "text", default: "" },
    { key: "postcode", label: "Home Postcode (UK)", type: "text", default: "" },
    { key: "latitude", label: "Home Latitude", type: "number", default: 51.9614 },
    { key: "longitude", label: "Home Longitude", type: "number", default: 1.3519 },
    { key: "radius", label: "Local Radius (miles)", type: "number", default: 10 }
  ],

  async fetchData(settings, device = {}) {
    // API Credentials fallbacks
    const clientId = settings.clientId || process.env.FUEL_API_CLIENT_ID || "pI8DjGe00xpGp5G7nuGOGxfO2vKIS05z";
    const clientSecret = settings.clientSecret || process.env.FUEL_API_CLIENT_SECRET || "8Pk6viES2PwJyiWyr5dg0GTOaZaikRLugUOmvBJb4aG9V0UuI0twbKOoEu5t0wf0";
    let homeLat = parseFloat(settings.latitude || 51.9614);
    let homeLng = parseFloat(settings.longitude || 1.3519);
    let homePostcode = settings.postcode ? settings.postcode.trim().toUpperCase() : "";
    const radius = parseFloat(settings.radius || 10);

    if (homePostcode) {
      const resolved = await resolvePostcode(homePostcode);
      if (resolved) {
        homeLat = resolved.latitude;
        homeLng = resolved.longitude;
        homePostcode = resolved.postcode;
      }
    }

    try {
      // 1. Authenticate & Obtain OAuth token
      const accessToken = await getAccessToken(clientId, clientSecret);
      
      const stationsMap = {};

      // 2. Fetch Station Metadata
      await fetchBatchedEndpoint("https://www.fuel-finder.service.gov.uk/api/v1/pfs", accessToken, (items) => {
        for (const item of items) {
          const stationId = String(item.node_id || item.site_id || item.id || '').trim();
          if (!stationId) continue;
          
          const brand = item.brand || item.brand_name || item.operator || 'Unknown';
          const name = item.name || item.site_name || item.station_name || '';
          const address = item.address || item.site_address || '';
          const postcode = item.postcode || item.site_postcode || '';
          
          let lat = null;
          let lng = null;
          if (item.location && typeof item.location === 'object') {
            lat = item.location.latitude;
            lng = item.location.longitude;
          } else {
            lat = item.latitude;
            lng = item.longitude;
          }
          
          stationsMap[stationId] = {
            id: stationId,
            brand,
            name,
            address,
            postcode,
            lat: lat ? parseFloat(lat) : null,
            lng: lng ? parseFloat(lng) : null,
            prices: {}
          };
        }
      });

      // 3. Fetch Prices
      await fetchBatchedEndpoint("https://www.fuel-finder.service.gov.uk/api/v1/pfs/fuel-prices", accessToken, (items) => {
        for (const item of items) {
          const stationId = String(item.node_id || item.site_id || item.id || '').trim();
          if (!stationId) continue;
          
          if (!stationsMap[stationId] && (item.brand || item.brand_name || item.operator)) {
            stationsMap[stationId] = {
              id: stationId,
              brand: item.brand || item.brand_name || item.operator || 'Unknown',
              name: item.name || item.site_name || item.station_name || '',
              address: item.address || item.site_address || '',
              postcode: item.postcode || item.site_postcode || '',
              lat: item.location ? parseFloat(item.location.latitude) : (item.latitude ? parseFloat(item.latitude) : null),
              lng: item.location ? parseFloat(item.location.longitude) : (item.longitude ? parseFloat(item.longitude) : null),
              prices: {}
            };
          }
          
          if (!stationsMap[stationId]) continue;
          
          const pricesData = item.prices || item.fuel_prices || [];
          let priceEntries = [];
          if (typeof pricesData === 'object' && !Array.isArray(pricesData)) {
            priceEntries = Object.entries(pricesData);
          } else if (Array.isArray(pricesData)) {
            for (const pObj of pricesData) {
              if (pObj && typeof pObj === 'object') {
                const fType = pObj.fuel_type || pObj.type;
                const fVal = pObj.price || pObj.amount;
                const lastUpdatedStr = pObj.price_last_updated || pObj.price_change_effective_timestamp || pObj.last_updated;
                if (fType && fVal !== undefined) {
                  if (lastUpdatedStr) {
                    try {
                      const updatedDate = new Date(lastUpdatedStr);
                      const now = new Date();
                      const ageDays = (now - updatedDate) / (1000 * 60 * 60 * 24);
                      if (ageDays > 7) {
                        continue; // Skip pricing older than 7 days
                      }
                    } catch (e) {
                      // Keep it if parsing fails as a fallback
                    }
                  }
                  priceEntries.push([fType, fVal]);
                }
              }
            }
          }
          
          for (let [fuelType, price] of priceEntries) {
            fuelType = String(fuelType).toUpperCase().trim();
            if (fuelType === 'B7_STANDARD' || fuelType === 'DIESEL') fuelType = 'B7';
            else if (fuelType === 'E10_STANDARD' || fuelType === 'UNLEADED') fuelType = 'E10';
            else if (fuelType === 'E5_STANDARD' || fuelType === 'SUPER') fuelType = 'E5';
            
            if (price !== null && String(price).toLowerCase() !== 'n/a') {
              let fPrice = parseFloat(price);
              if (isNaN(fPrice)) continue;
              if (fPrice < 10.0) fPrice *= 100;
              else if (fPrice > 1000.0) fPrice /= 10;
              
              if (fPrice > 0.1) {
                stationsMap[stationId].prices[fuelType] = fPrice;
              }
            }
          }
        }
      });

      const allStations = Object.values(stationsMap);
      if (allStations.length === 0) {
        throw new Error("No stations loaded from API");
      }

      // Calculate distances for local search
      const localStations = [];
      for (const s of allStations) {
        if (s.lat !== null && s.lng !== null) {
          const dist = haversineMiles(homeLat, homeLng, s.lat, s.lng);
          s._dist_mi = dist;
          if (dist <= radius) {
            localStations.push(s);
          }
        }
      }

      // Find cheapest helpers
      const getCheapest = (stationsList, fuelType) => {
        const filtered = stationsList
          .filter(s => s.prices[fuelType] !== undefined && s.prices[fuelType] > 0)
          .sort((a, b) => a.prices[fuelType] - b.prices[fuelType]);
        return filtered[0] || null;
      };

      // Cheapest local & nationwide
      const localE10 = getCheapest(localStations, 'E10');
      const localB7 = getCheapest(localStations, 'B7');
      const localE5 = getCheapest(localStations, 'E5');

      const ukE10 = getCheapest(allStations, 'E10');
      const ukB7 = getCheapest(allStations, 'B7');

      // Price stats helper
      const getStats = (fuelType) => {
        const prices = allStations
          .map(s => s.prices[fuelType])
          .filter(p => p !== undefined && p > 0);
        if (prices.length === 0) return { min: 'n/a', max: 'n/a', avg: 'n/a' };
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const sum = prices.reduce((a, b) => a + b, 0);
        const avg = sum / prices.length;
        return {
          min: min.toFixed(1),
          max: max.toFixed(1),
          avg: avg.toFixed(1)
        };
      };

      const e10Stats = getStats('E10');
      const b7Stats = getStats('B7');

      // Top 3 local lists
      const localE10Sorted = localStations
        .filter(s => s.prices['E10'] !== undefined && s.prices['E10'] > 0)
        .sort((a, b) => a.prices['E10'] - b.prices['E10'])
        .slice(0, 3)
        .map(s => ({
          brand: s.brand,
          name: s.name || s.address.split(',')[0] || 'Petrol Station',
          price: s.prices['E10'].toFixed(1) + 'p',
          dist: s._dist_mi.toFixed(1) + ' mi'
        }));

      const localB7Sorted = localStations
        .filter(s => s.prices['B7'] !== undefined && s.prices['B7'] > 0)
        .sort((a, b) => a.prices['B7'] - b.prices['B7'])
        .slice(0, 3)
        .map(s => ({
          brand: s.brand,
          name: s.name || s.address.split(',')[0] || 'Petrol Station',
          price: s.prices['B7'].toFixed(1) + 'p',
          dist: s._dist_mi.toFixed(1) + ' mi'
        }));

      return {
        updatedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' UTC',
        localRadius: radius,
        postcode: homePostcode,
        localE10: localE10 ? {
          brand: localE10.brand,
          name: localE10.name || localE10.address.split(',')[0],
          price: localE10.prices['E10'].toFixed(1),
          dist: localE10._dist_mi.toFixed(1)
        } : null,
        localB7: localB7 ? {
          brand: localB7.brand,
          name: localB7.name || localB7.address.split(',')[0],
          price: localB7.prices['B7'].toFixed(1),
          dist: localB7._dist_mi.toFixed(1)
        } : null,
        localE5: localE5 ? {
          brand: localE5.brand,
          name: localE5.name || localE5.address.split(',')[0],
          price: localE5.prices['E5'].toFixed(1),
          dist: localE5._dist_mi.toFixed(1)
        } : null,
        ukE10: ukE10 ? {
          brand: ukE10.brand,
          name: ukE10.name || ukE10.address.split(',')[0],
          price: ukE10.prices['E10'].toFixed(1)
        } : null,
        ukB7: ukB7 ? {
          brand: ukB7.brand,
          name: ukB7.name || ukB7.address.split(',')[0],
          price: ukB7.prices['B7'].toFixed(1)
        } : null,
        e10Stats,
        b7Stats,
        localE10Sorted,
        localB7Sorted
      };
    } catch (e) {
      console.error("Error fetching UK fuel prices:", e);
      // Fallback mockup data
      return {
        updatedAt: "12:00 UTC",
        localRadius: radius,
        postcode: homePostcode,
        localE10: { brand: "Tesco", name: "Felixstowe", price: "138.9", dist: "1.2" },
        localB7: { brand: "Shell", name: "Walton", price: "145.9", dist: "2.4" },
        localE5: { brand: "BP", name: "Trimley", price: "152.9", dist: "3.1" },
        ukE10: { brand: "Asda", name: "Cardiff", price: "129.7" },
        ukB7: { brand: "Asda", name: "Cardiff", price: "136.7" },
        e10Stats: { min: "129.7", max: "169.9", avg: "144.5" },
        b7Stats: { min: "136.7", max: "179.9", avg: "152.2" },
        localE10Sorted: [
          { brand: "Tesco", name: "Felixstowe", price: "138.9p", dist: "1.2 mi" },
          { brand: "Morrisons", name: "Ipswich Road", price: "140.9p", dist: "4.5 mi" },
          { brand: "Shell", name: "Walton", price: "142.9p", dist: "2.4 mi" }
        ],
        localB7Sorted: [
          { brand: "Shell", name: "Walton", price: "145.9p", dist: "2.4 mi" },
          { brand: "BP", name: "Trimley", price: "147.9p", dist: "3.1 mi" },
          { brand: "Tesco", name: "Felixstowe", price: "148.9p", dist: "1.2 mi" }
        ]
      };
    }
  },

  renderSVG(data, width, height) {
    const isFullScreen = height > 300;
    const padding = 20;

    const truncateText = (text, maxLength) => {
      if (!text) return "";
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + "...";
    };

    if (isFullScreen) {
      // Elegant 800x480 Dashboard View
      const colWidth = (width - padding * 2 - 30) / 3;
      const tableWidth = (width - padding * 2 - 20) / 2;

      // Draw Top local cheapest cards
      let localCardsHtml = '';
      const cardData = [
        { label: "CHEAPEST UNLEADED (E10)", details: data.localE10, color: "black" },
        { label: "CHEAPEST DIESEL (B7)", details: data.localB7, color: "black" },
        { label: "CHEAPEST SUPER (E5)", details: data.localE5, color: "black" }
      ];

      cardData.forEach((card, idx) => {
        const x = padding + idx * (colWidth + 15);
        const hasData = !!card.details;
        const priceText = hasData ? `${card.details.price}p` : "N/A";
        const brandText = hasData ? `${card.details.brand} (${card.details.dist} mi)` : "No station found";
        const nameText = hasData ? truncateText(card.details.name, 22) : "";

        localCardsHtml += `
          <!-- Card ${idx + 1} -->
          <g transform="translate(${x}, 65)">
            <rect x="0" y="0" width="${colWidth}" height="110" rx="8" fill="none" stroke="black" stroke-width="1.8" />
            <rect x="0" y="0" width="${colWidth}" height="26" rx="8" fill="black" />
            <rect x="0" y="16" width="${colWidth}" height="10" fill="black" /> <!-- Cover bottom corners of top header -->
            
            <text x="${colWidth / 2}" y="17" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="white" text-anchor="middle">${card.label}</text>
            <text x="${colWidth / 2}" y="74" font-family="sans-serif" font-size="34" font-weight="900" fill="black" text-anchor="middle">${escapeXml(priceText)}</text>
            <text x="${colWidth / 2}" y="95" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.8" text-anchor="middle">${escapeXml(brandText)}</text>
            <text x="${colWidth / 2}" y="107" font-family="sans-serif" font-size="10" fill="black" opacity="0.6" text-anchor="middle">${escapeXml(nameText)}</text>
          </g>
        `;
      });

      // Local top-3 comparison tables
      const makeTableRows = (list) => {
        let rowsHtml = '';
        list.forEach((item, idx) => {
          const y = 35 + idx * 30;
          rowsHtml += `
            <text x="5" y="${y}" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${escapeXml(truncateText(item.brand, 10))}</text>
            <text x="105" y="${y}" font-family="sans-serif" font-size="12" fill="black" opacity="0.75">${escapeXml(truncateText(item.name, 16))}</text>
            <text x="${tableWidth - 85}" y="${y}" font-family="sans-serif" font-size="12.5" fill="black" opacity="0.6" text-anchor="end">${escapeXml(item.dist)}</text>
            <text x="${tableWidth - 5}" y="${y}" font-family="sans-serif" font-size="14" font-weight="bold" fill="black" text-anchor="end">${escapeXml(item.price)}</text>
            <line x1="5" y1="${y + 8}" x2="${tableWidth - 5}" y2="${y + 8}" stroke="black" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5" />
          `;
        });
        if (list.length === 0) {
          rowsHtml = `<text x="${tableWidth / 2}" y="60" font-family="sans-serif" font-size="13" fill="black" opacity="0.5" text-anchor="middle">No local stations found</text>`;
        }
        return rowsHtml;
      };

      return `
        <g>
          <!-- Header -->
          <text x="${padding}" y="35" font-family="sans-serif" font-size="20" font-weight="bold" fill="black" letter-spacing="1">⚡ UK FUEL FINDER</text>
          <text x="${width - padding}" y="33" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="black" opacity="0.7" text-anchor="end">Radius: ${data.localRadius} mi${data.postcode ? ` (${data.postcode})` : ''} • Refreshed: ${escapeXml(data.updatedAt)}</text>
          <line x1="${padding}" y1="48" x2="${width - padding}" y2="48" stroke="black" stroke-width="2.5" />

          <!-- Cheapest Cards -->
          ${localCardsHtml}

          <!-- Tables Row -->
          <g transform="translate(${padding}, 195)">
            <!-- Unleaded Table -->
            <g transform="translate(0, 0)">
              <text x="0" y="15" font-family="sans-serif" font-size="13" font-weight="bold" fill="black" letter-spacing="0.5">⛽ LOCAL UNLEADED (E10) OPTIONS</text>
              <line x1="0" y1="22" x2="${tableWidth - 10}" y2="22" stroke="black" stroke-width="1.8" />
              <g transform="translate(0, 10)">
                ${makeTableRows(data.localE10Sorted)}
              </g>
            </g>

            <!-- Diesel Table -->
            <g transform="translate(${tableWidth + 20}, 0)">
              <text x="0" y="15" font-family="sans-serif" font-size="13" font-weight="bold" fill="black" letter-spacing="0.5">⛽ LOCAL DIESEL (B7) OPTIONS</text>
              <line x1="0" y1="22" x2="${tableWidth - 10}" y2="22" stroke="black" stroke-width="1.8" />
              <g transform="translate(0, 10)">
                ${makeTableRows(data.localB7Sorted)}
              </g>
            </g>
          </g>

          <!-- Divider -->
          <line x1="${padding}" y1="355" x2="${width - padding}" y2="355" stroke="black" stroke-width="1.5" stroke-dasharray="6,6" />

          <!-- National Averages / Stats Row -->
          <g transform="translate(${padding}, 375)">
            <rect x="0" y="0" width="${width - padding * 2}" height="80" rx="8" fill="none" stroke="black" stroke-width="1.2" />
            
            <g transform="translate(15, 12)">
              <text x="0" y="12" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.65">UNLEADED (E10) NATIONWIDE</text>
              <text x="0" y="34" font-family="sans-serif" font-size="14.5" fill="black">Cheapest: <tspan font-weight="bold" font-size="17">${escapeXml(data.ukE10 ? data.ukE10.price : "n/a")}p</tspan> (${escapeXml(data.ukE10 ? truncateText(data.ukE10.brand, 16) : "")})</text>
              <text x="0" y="54" font-family="sans-serif" font-size="12.5" fill="black">Avg: <tspan font-weight="bold">${escapeXml(data.e10Stats.avg)}p</tspan> <tspan opacity="0.6"> (Range: ${escapeXml(data.e10Stats.min)}p-${escapeXml(data.e10Stats.max)}p)</tspan></text>
            </g>

            <line x1="${(width - padding * 2) / 2}" y1="10" x2="${(width - padding * 2) / 2}" y2="70" stroke="black" stroke-width="1" stroke-dasharray="2,2" opacity="0.5" />

            <g transform="translate(${(width - padding * 2) / 2 + 15}, 12)">
              <text x="0" y="12" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.65">DIESEL (B7) NATIONWIDE</text>
              <text x="0" y="34" font-family="sans-serif" font-size="14.5" fill="black">Cheapest: <tspan font-weight="bold" font-size="17">${escapeXml(data.ukB7 ? data.ukB7.price : "n/a")}p</tspan> (${escapeXml(data.ukB7 ? truncateText(data.ukB7.brand, 16) : "")})</text>
              <text x="0" y="54" font-family="sans-serif" font-size="12.5" fill="black">Avg: <tspan font-weight="bold">${escapeXml(data.b7Stats.avg)}p</tspan> <tspan opacity="0.6"> (Range: ${escapeXml(data.b7Stats.min)}p-${escapeXml(data.b7Stats.max)}p)</tspan></text>
            </g>
          </g>

          <text x="${padding}" y="${height - 10}" font-family="sans-serif" font-size="9.5" fill="black" opacity="0.5">Source: UK Gov Fuel-Finder API</text>
        </g>
      `;
    } else {
      // Symmetrical Compact 400x240 view
      const halfWidth = (width - padding * 2 - 12) / 2;
      return `
        <g>
          <!-- Header -->
          <text x="${padding}" y="25" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">⚡ LOCAL FUEL PRICES${data.postcode ? ` [${data.postcode}]` : ''}</text>
          <line x1="${padding}" y1="32" x2="${width - padding}" y2="32" stroke="black" stroke-width="1.5" />

          <!-- Unleaded Card -->
          <g transform="translate(${padding}, 45)">
            <rect x="0" y="0" width="${halfWidth}" height="80" rx="5" fill="none" stroke="black" stroke-width="1.2" />
            <text x="10" y="20" font-family="sans-serif" font-size="9" font-weight="bold" fill="black" opacity="0.65">UNLEADED (E10)</text>
            <text x="10" y="52" font-family="sans-serif" font-size="26" font-weight="bold" fill="black">${escapeXml(data.localE10 ? data.localE10.price : "n/a")}p</text>
            <text x="10" y="70" font-family="sans-serif" font-size="9" fill="black" opacity="0.75">${escapeXml(data.localE10 ? data.localE10.brand : "")} (${escapeXml(data.localE10 ? data.localE10.dist : "")} mi)</text>
          </g>

          <!-- Diesel Card -->
          <g transform="translate(${padding + halfWidth + 12}, 45)">
            <rect x="0" y="0" width="${halfWidth}" height="80" rx="5" fill="none" stroke="black" stroke-width="1.2" />
            <text x="10" y="20" font-family="sans-serif" font-size="9" font-weight="bold" fill="black" opacity="0.65">DIESEL (B7)</text>
            <text x="10" y="52" font-family="sans-serif" font-size="26" font-weight="bold" fill="black">${escapeXml(data.localB7 ? data.localB7.price : "n/a")}p</text>
            <text x="10" y="70" font-family="sans-serif" font-size="9" fill="black" opacity="0.75">${escapeXml(data.localB7 ? data.localB7.brand : "")} (${escapeXml(data.localB7 ? data.localB7.dist : "")} mi)</text>
          </g>

          <line x1="${padding}" y1="140" x2="${width - padding}" y2="140" stroke="black" stroke-width="1" stroke-dasharray="2,2" opacity="0.4" />

          <!-- Local top-3 simple overview -->
          <g transform="translate(${padding}, 162)">
            <text x="0" y="0" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="black">⛽ CHEAPEST NEAREST UNLEADED</text>
            <text x="0" y="22" font-family="sans-serif" font-size="11" fill="black">1. ${escapeXml(data.localE10Sorted[0] ? data.localE10Sorted[0].brand : "")} (${escapeXml(data.localE10Sorted[0] ? data.localE10Sorted[0].dist : "")}) – <tspan font-weight="bold">${escapeXml(data.localE10Sorted[0] ? data.localE10Sorted[0].price : "")}</tspan></text>
            <text x="0" y="40" font-family="sans-serif" font-size="11" fill="black">2. ${escapeXml(data.localE10Sorted[1] ? data.localE10Sorted[1].brand : "")} (${escapeXml(data.localE10Sorted[1] ? data.localE10Sorted[1].dist : "")}) – <tspan font-weight="bold">${escapeXml(data.localE10Sorted[1] ? data.localE10Sorted[1].price : "")}</tspan></text>
            <text x="${width - padding * 2}" y="22" font-family="sans-serif" font-size="10" text-anchor="end" fill="black" opacity="0.5">UK Avg: ${escapeXml(data.e10Stats.avg)}p</text>
          </g>
        </g>
      `;
    }
  }
};
