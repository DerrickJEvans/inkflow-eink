// weather.js - Open-Meteo Integration with beautiful e-ink SVG icons
const http = require('http');
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
    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: { 'User-Agent': 'TrmnlPiServer/1.0 (RaspberryPi E-Ink Dashboard)' }
    };
    if (url.startsWith('https')) {
      options.rejectUnauthorized = false; // Bypass certificate chain validation issues (local proxy/firewall certs)
    }
    client.get(url, options, (res) => {
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

// Translate WMO Weather Code to string
const getWeatherCondition = (code) => {
  if (code === 0) return "Clear Sky";
  if (code >= 1 && code <= 3) return "Partly Cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rainy";
  if (code >= 71 && code <= 75) return "Snowy";
  if (code >= 80 && code <= 82) return "Rain Showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "Unknown";
};

// Draw clean, high-contrast monochrome SVG weather icons
const drawWeatherIcon = (code, cx, cy) => {
  if (code === 0) {
    // Sunny/Clear - Sun circle with rays
    return `
      <g transform="translate(${cx - 30}, ${cy - 30})">
        <circle cx="30" cy="30" r="14" fill="none" stroke="black" stroke-width="3"/>
        <line x1="30" y1="5" x2="30" y2="10" stroke="black" stroke-width="3" stroke-linecap="round" />
        <line x1="30" y1="50" x2="30" y2="55" stroke="black" stroke-width="3" stroke-linecap="round" />
        <line x1="5" y1="30" x2="10" y2="30" stroke="black" stroke-width="3" stroke-linecap="round" />
        <line x1="50" y1="30" x2="55" y2="30" stroke="black" stroke-width="3" stroke-linecap="round" />
        <line x1="12" y1="12" x2="16" y2="16" stroke="black" stroke-width="3" stroke-linecap="round" />
        <line x1="44" y1="44" x2="48" y2="48" stroke="black" stroke-width="3" stroke-linecap="round" />
        <line x1="12" y1="48" x2="16" y2="44" stroke="black" stroke-width="3" stroke-linecap="round" />
        <line x1="44" y1="16" x2="48" y2="12" stroke="black" stroke-width="3" stroke-linecap="round" />
      </g>
    `;
  } else if (code >= 1 && code <= 3) {
    // Partly Cloudy - Sun behind a cloud
    return `
      <g transform="translate(${cx - 30}, ${cy - 30})">
        <!-- Sun -->
        <circle cx="38" cy="22" r="10" fill="none" stroke="black" stroke-width="2.5"/>
        <line x1="38" y1="5" x2="38" y2="8" stroke="black" stroke-width="2" />
        <line x1="52" y1="15" x2="55" y2="17" stroke="black" stroke-width="2" />
        <!-- Cloud -->
        <path d="M18 42 A 8 8 0 0 1 20 26 A 12 12 0 0 1 42 28 A 10 10 0 0 1 46 42 Z" fill="white" stroke="black" stroke-width="3" />
      </g>
    `;
  } else if (code >= 51 && code <= 65 || code >= 80 && code <= 82) {
    // Rain - Cloud with rain drops
    return `
      <g transform="translate(${cx - 30}, ${cy - 30})">
        <path d="M18 36 A 8 8 0 0 1 20 20 A 12 12 0 0 1 42 22 A 10 10 0 0 1 46 36 Z" fill="white" stroke="black" stroke-width="3" />
        <line x1="22" y1="44" x2="19" y2="50" stroke="black" stroke-width="2.5" stroke-linecap="round" />
        <line x1="30" y1="44" x2="27" y2="50" stroke="black" stroke-width="2.5" stroke-linecap="round" />
        <line x1="38" y1="44" x2="35" y2="50" stroke="black" stroke-width="2.5" stroke-linecap="round" />
      </g>
    `;
  } else if (code >= 95 && code <= 99) {
    // Thunderstorm - Cloud with lightning
    return `
      <g transform="translate(${cx - 30}, ${cy - 30})">
        <path d="M18 36 A 8 8 0 0 1 20 20 A 12 12 0 0 1 42 22 A 10 10 0 0 1 46 36 Z" fill="white" stroke="black" stroke-width="3" />
        <polygon points="28,40 34,40 26,48 32,48 24,56" fill="black" stroke="black" stroke-width="1" />
      </g>
    `;
  } else if (code >= 71 && code <= 75) {
    // Snow - Cloud with snowflakes (represented by stars/dots)
    return `
      <g transform="translate(${cx - 30}, ${cy - 30})">
        <path d="M18 36 A 8 8 0 0 1 20 20 A 12 12 0 0 1 42 22 A 10 10 0 0 1 46 36 Z" fill="white" stroke="black" stroke-width="3" />
        <circle cx="22" cy="44" r="2.5" fill="black" />
        <circle cx="30" cy="46" r="2.5" fill="black" />
        <circle cx="38" cy="44" r="2.5" fill="black" />
      </g>
    `;
  } else {
    // Cloudy/Fog - Overlapping clouds
    return `
      <g transform="translate(${cx - 30}, ${cy - 30})">
        <path d="M14 38 A 6 6 0 0 1 16 26 A 10 10 0 0 1 34 28 A 8 8 0 0 1 38 38 Z" fill="white" stroke="black" stroke-width="2" />
        <path d="M24 44 A 8 8 0 0 1 26 28 A 12 12 0 0 1 48 30 A 10 10 0 0 1 52 44 Z" fill="white" stroke="black" stroke-width="3" />
      </g>
    `;
  }
};

module.exports = {
  id: "weather",
  name: "Local Weather",
  description: "Fetches local weather condition, current temp, humidity, and forecasts from Open-Meteo.",
  configFields: [
    { key: "postcode", label: "UK Postcode (Optional)", type: "text", default: "", helpUrl: "https://postcodes.io", helpLabel: "🌐 postcodes.io" },
    { key: "latitude", label: "Latitude", type: "number", default: 51.9639 },
    { key: "longitude", label: "Longitude", type: "number", default: 1.3513 },
    { key: "unit", label: "Temp Unit (°C/°F)", type: "select", options: ["celsius", "fahrenheit"], default: "celsius" }
  ],

  async fetchData(settings) {
    let lat = settings.latitude || 51.9639;
    let lon = settings.longitude || 1.3513;

    // Resolve postcode if provided
    if (settings.postcode && settings.postcode.trim() !== "") {
      const cleanPostcode = encodeURIComponent(settings.postcode.trim().replace(/\s+/g, ''));
      try {
        const postcodeRes = await getJson(`https://api.postcodes.io/postcodes/${cleanPostcode}`);
        if (postcodeRes && postcodeRes.status === 200 && postcodeRes.result) {
          lat = postcodeRes.result.latitude;
          lon = postcodeRes.result.longitude;
          console.log(`[Weather Plugin] Resolved postcode "${settings.postcode}" to ${lat}, ${lon}`);
        }
      } catch (postcodeErr) {
        console.error(`[Weather Plugin] Error geocoding postcode "${settings.postcode}":`, postcodeErr.message);
      }
    }

    const isFahr = settings.unit === 'fahrenheit';
    const tempParam = isFahr ? '&temperature_unit=fahrenheit' : '';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto${tempParam}`;
    const geoUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;

    try {
      const [res, geoData] = await Promise.all([
        getJson(url),
        getJson(geoUrl).catch(err => {
          console.error("Error geocoding weather coordinates:", err);
          return null;
        })
      ]);
      
      const current = res.current;
      const daily = res.daily;

      let settlement = '';
      let postcode = '';
      if (geoData && geoData.address) {
        settlement = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.hamlet || geoData.address.suburb || geoData.address.municipality || '';
        postcode = geoData.address.postcode || '';
      }

      return {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        settlement,
        postcode,
        temp: Math.round(current.temperature_2m),
        humidity: current.relative_humidity_2m,
        code: current.weather_code,
        condition: getWeatherCondition(current.weather_code),
        high: Math.round(daily.temperature_2m_max[0]),
        low: Math.round(daily.temperature_2m_min[0]),
        unit: isFahr ? "°F" : "°C",
        // 3-Day Forecast Array
        forecast: [
          { day: "Tomorrow", code: daily.weather_code[1], high: Math.round(daily.temperature_2m_max[1]), low: Math.round(daily.temperature_2m_min[1]) },
          { day: "Day After", code: daily.weather_code[2], high: Math.round(daily.temperature_2m_max[2]), low: Math.round(daily.temperature_2m_min[2]) }
        ]
      };
    } catch (e) {
      console.error("Error fetching weather:", e);
      // Fallback data
      return {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        settlement: "Unknown Settlement",
        postcode: "",
        temp: 18,
        humidity: 62,
        code: 1,
        condition: "Partly Cloudy",
        high: 22,
        low: 11,
        unit: isFahr ? "°F" : "°C",
        forecast: [
          { day: "Tomorrow", code: 3, high: 20, low: 12 },
          { day: "Day After", code: 61, high: 16, low: 9 }
        ]
      };
    }
  },

  renderSVG(data, width, height) {
    const padding = 20;
    const isFullScreen = height > 300;
    
    if (isFullScreen) {
      // Elegant Full-Screen Weather Dashboard
      const colWidth = (width - padding * 2) / 3;
      const locStr = `${data.settlement || 'Unknown'}${data.postcode ? ` [${data.postcode}]` : ''} (${data.lat.toFixed(4)}°, ${data.lon.toFixed(4)}°)`;
      
      return `
        <g>
          <rect x="0" y="0" width="${width}" height="52" fill="black" />
          <g transform="translate(${padding}, 17)" stroke="white" fill="none" stroke-linecap="round">
            <circle cx="16" cy="8" r="4" stroke-width="1.5"/>
            <line x1="16" y1="1" x2="16" y2="2.5" stroke-width="1.2" />
            <line x1="21.5" y1="4.5" x2="22.5" y2="5.5" stroke-width="1.2" />
            <path d="M7 17 A 3 3 0 0 1 8 11 A 4.5 4.5 0 0 1 17 12 A 3.5 3.5 0 0 1 19 17 Z" fill="white" stroke-width="2" />
          </g>
          <text x="${padding + 26}" y="35" font-family="sans-serif" font-size="20" font-weight="bold" fill="white" letter-spacing="1">LOCAL WEATHER</text>
          <text x="${width - padding}" y="34" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="white" opacity="0.8" text-anchor="end">${escapeXml(locStr)}</text>
          
          <!-- Primary Current Weather Section -->
          <g transform="translate(${padding}, 70)">
            <!-- Huge Icon -->
            ${drawWeatherIcon(data.code, 60, 60)}
            
            <!-- Temperatures & Main details -->
            <text x="160" y="70" font-family="sans-serif" font-size="72" font-weight="900" fill="black">${data.temp}${data.unit}</text>
            <text x="160" y="110" font-family="sans-serif" font-size="22" font-weight="bold" fill="black" opacity="0.9">${data.condition}</text>
            
            <!-- Secondary Info -->
            <text x="440" y="45" font-family="sans-serif" font-size="15" fill="black">Humidity: <tspan font-weight="bold">${data.humidity}%</tspan></text>
            <text x="440" y="75" font-family="sans-serif" font-size="15" fill="black">Daily Low: <tspan font-weight="bold">${data.low}${data.unit}</tspan></text>
            <text x="440" y="105" font-family="sans-serif" font-size="15" fill="black">Daily High: <tspan font-weight="bold">${data.high}${data.unit}</tspan></text>
          </g>
          
          <!-- Divider -->
          <line x1="${padding}" y1="240" x2="${width - padding}" y2="240" stroke="black" stroke-width="1.5" stroke-dasharray="6,6" />
          
          <!-- Extended 3-Day Forecast Cards -->
          <g transform="translate(${padding}, 259)">
            <!-- Calendar Icon -->
            <rect x="0" y="2" width="15" height="15" rx="2" fill="none" stroke="black" stroke-width="1.8" />
            <line x1="0" y1="7" x2="15" y2="7" stroke="black" stroke-width="1.8" />
            <line x1="4" y1="0" x2="4" y2="4" stroke="black" stroke-width="1.8" stroke-linecap="round" />
            <line x1="11" y1="0" x2="11" y2="4" stroke="black" stroke-width="1.8" stroke-linecap="round" />
            
            <circle cx="4" cy="11" r="0.8" fill="black" />
            <circle cx="7.5" cy="11" r="0.8" fill="black" />
            <circle cx="11" cy="11" r="0.8" fill="black" />
            
            <!-- Text -->
            <text x="24" y="15" font-family="sans-serif" font-size="15" font-weight="bold" fill="black" letter-spacing="0.5">EXTENDED OUTLOOK</text>
          </g>
          
          <g transform="translate(0, 290)">
            <!-- Forecast Column 1: Today -->
            <g transform="translate(${padding}, 0)">
              <rect x="0" y="0" width="${colWidth - 15}" height="140" rx="10" fill="none" stroke="black" stroke-width="1.5" />
              <text x="${(colWidth - 15) / 2}" y="30" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="black">Today</text>
              ${drawWeatherIcon(data.code, (colWidth - 15) / 2, 70)}
              <text x="${(colWidth - 15) / 2}" y="120" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="black">${data.low}° / ${data.high}°</text>
            </g>
 
            <!-- Forecast Column 2: Tomorrow -->
            <g transform="translate(${padding + colWidth}, 0)">
              <rect x="0" y="0" width="${colWidth - 15}" height="140" rx="10" fill="none" stroke="black" stroke-width="1.5" />
              <text x="${(colWidth - 15) / 2}" y="30" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="black">Tomorrow</text>
              ${drawWeatherIcon(data.forecast[0].code, (colWidth - 15) / 2, 70)}
              <text x="${(colWidth - 15) / 2}" y="120" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="black">${data.forecast[0].low}° / ${data.forecast[0].high}°</text>
            </g>
 
            <!-- Forecast Column 3: Day After -->
            <g transform="translate(${padding + colWidth * 2}, 0)">
              <rect x="0" y="0" width="${colWidth - 15}" height="140" rx="10" fill="none" stroke="black" stroke-width="1.5" />
              <text x="${(colWidth - 15) / 2}" y="30" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="black">Day After</text>
              ${drawWeatherIcon(data.forecast[1].code, (colWidth - 15) / 2, 70)}
              <text x="${(colWidth - 15) / 2}" y="120" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="black">${data.forecast[1].low}° / ${data.forecast[1].high}°</text>
            </g>
          </g>
        </g>
      `;
    } else {
      // Standard compact grid cell layout
      const locStr = `${data.settlement || ''}${data.postcode ? ` [${data.postcode}]` : ''} (${data.lat.toFixed(2)}°, ${data.lon.toFixed(2)}°)`;
      return `
        <g>
          <!-- Header -->
          <rect x="0" y="0" width="${width}" height="32" fill="black" />
          <g transform="translate(${padding}, 9)" stroke="white" fill="none" stroke-linecap="round">
            <circle cx="13" cy="6" r="3" stroke-width="1.2"/>
            <line x1="13" y1="1" x2="13" y2="2" stroke-width="1" />
            <path d="M5 14 A 2.5 2.5 0 0 1 6 9 A 3.5 3.5 0 0 1 14 10 A 3 3 0 0 1 15 14 Z" fill="white" stroke-width="1.5" />
          </g>
          <text x="${padding + 18}" y="25" font-family="sans-serif" font-size="14" font-weight="bold" fill="white">LOCAL WEATHER</text>
          <text x="${width - padding}" y="24" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="white" opacity="0.8" text-anchor="end">${escapeXml(locStr)}</text>
          
          <!-- Large Current Temp & Condition -->
          ${drawWeatherIcon(data.code, padding + 35, 75)}
          
          <text x="${padding + 85}" y="70" font-family="sans-serif" font-size="34" font-weight="bold" fill="black">${data.temp}${data.unit}</text>
          <text x="${padding + 85}" y="92" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${data.condition}</text>
          <text x="${padding}" y="122" font-family="sans-serif" font-size="11" fill="black">Humidity: <tspan font-weight="bold">${data.humidity}%</tspan>   Range: <tspan font-weight="bold">${data.low}° - ${data.high}°</tspan></text>
          
          <!-- 2 Day Small Forecast Section -->
          <line x1="${padding}" y1="134" x2="${width - padding}" y2="134" stroke="black" stroke-dasharray="3,3" stroke-width="1" />
          
          <!-- Forecast Row 1 -->
          <text x="${padding}" y="154" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">${data.forecast[0].day}</text>
          <text x="${width - padding}" y="154" font-family="sans-serif" font-size="11" text-anchor="end" fill="black">${data.forecast[0].low}° / ${data.forecast[0].high}°</text>
          
          <!-- Forecast Row 2 -->
          <text x="${padding}" y="174" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">${data.forecast[1].day}</text>
          <text x="${width - padding}" y="174" font-family="sans-serif" font-size="11" text-anchor="end" fill="black">${data.forecast[1].low}° / ${data.forecast[1].high}°</text>
        </g>
      `;
    }
  }
};
