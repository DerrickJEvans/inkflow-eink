// world_clock.js - Greenwich-Centered Day/Night World Map & Apparent Sun/Moon Coordinates
const fs = require('fs');
const path = require('path');

const mapPath = path.join(__dirname, '..', 'public', 'world_map_bg.png');
let mapBase64 = '';
try {
  if (fs.existsSync(mapPath)) {
    mapBase64 = fs.readFileSync(mapPath, 'base64');
  } else {
    console.warn(`[world_clock] Warning: World map image not found at ${mapPath}`);
  }
} catch (e) {
  console.error("[world_clock] Error reading world map file:", e);
}

// 60x20 Minimalist Dot-Matrix World Map Outline
const MAP_GRID = [
  "                  ######                                    ",
  "   ####          #######             ###########            ",
  "  ######        #########         ###############           ",
  " ########      ###########       #################     ##   ",
  " #########     ###########      ###################   ####  ",
  "  #######       #########       ###################  #####  ",
  "   #####         #######        ##################   #####  ",
  "    ###          #######         ################     ###   ",
  "     #          #########         ##############            ",
  "                #########          ###########       ####   ",
  "               ##########           #########       ######  ",
  "               ##########            #######        ######  ",
  "               ##########             #####          ####   ",
  "               #########              #####                 ",
  "                #######                ###            #     ",
  "                 #####                  #            ###    ",
  "                  ###                                       ",
  "                   #                                        ",
  "   #######################################################  ",
  "   #######################################################  "
];

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

// Calculate Day of Year (1-366)
const getDayOfYear = (date) => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
};

// Calculates the subsolar latitude (declination) and longitude (degrees East)
const getSubsolarPoint = (date) => {
  const day = getDayOfYear(date);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  
  // Solar declination (degrees, tilt of earth relative to sun)
  const declination = 23.44 * Math.sin((2 * Math.PI / 365.24) * (day - 80));
  
  // Solar longitude (degrees East, GHA noon is 0)
  let longitude = -(hours - 12) * 15;
  while (longitude <= -180) longitude += 360;
  while (longitude > 180) longitude -= 360;
  
  return { latitude: declination, longitude };
};

// Calculates Moon details (Age, Phase, Sub-Lunar point, Declination)
const getMoonDetails = (date) => {
  const refDate = new Date(Date.UTC(2000, 0, 6, 18, 14, 0)); // Reference New Moon
  const synodicMonth = 29.530588853;
  const siderealMonth = 27.321661;
  const diffMs = date - refDate;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  // Synodic phase (0.0 New -> 0.5 Full -> 1.0 New)
  let phase = (diffDays / synodicMonth) % 1;
  if (phase < 0) phase += 1;
  const age = phase * synodicMonth;
  
  // Sidereal phase (orbit relative to stars)
  let siderealPhase = (diffDays / siderealMonth) % 1;
  if (siderealPhase < 0) siderealPhase += 1;
  
  let phaseName = "";
  let icon = "";
  if (phase < 0.03 || phase > 0.97) { phaseName = "New Moon"; icon = "🌑"; }
  else if (phase >= 0.03 && phase < 0.22) { phaseName = "Waxing Crescent"; icon = "🌒"; }
  else if (phase >= 0.22 && phase < 0.28) { phaseName = "First Quarter"; icon = "🌓"; }
  else if (phase >= 0.28 && phase < 0.47) { phaseName = "Waxing Gibbous"; icon = "🌔"; }
  else if (phase >= 0.47 && phase < 0.53) { phaseName = "Full Moon"; icon = "🌕"; }
  else if (phase >= 0.53 && phase < 0.72) { phaseName = "Waning Gibbous"; icon = "🌖"; }
  else if (phase >= 0.72 && phase < 0.78) { phaseName = "Third Quarter"; icon = "🌗"; }
  else if (phase >= 0.78 && phase <= 0.97) { phaseName = "Waning Crescent"; icon = "🌘"; }
  else { phaseName = "New Moon"; icon = "🌑"; }

  // Moon longitude: based on sun's longitude plus relative phase angle
  const sunPos = getSubsolarPoint(date);
  let moonLon = sunPos.longitude + phase * 360;
  while (moonLon <= -180) moonLon += 360;
  while (moonLon > 180) moonLon -= 360;
  
  // Moon declination (degrees, sinusoidal orbital oscillation)
  const moonLat = 28 * Math.sin(siderealPhase * 2 * Math.PI);

  return { age, phase, phaseName, icon, latitude: moonLat, longitude: moonLon };
};

// Calculates Sunrise and Sunset in UTC decimal hours (NOAA standard model approximation)
const calculateSunriseSunset = (lat, lon, date) => {
  const day = getDayOfYear(date);
  const phi = lat * Math.PI / 180; // Latitude in radians
  
  // Solar Declination in radians
  const declination = 23.44 * Math.sin((2 * Math.PI / 365.24) * (day - 80)) * Math.PI / 180;
  
  // Equation of time correction
  const B = (360 / 365) * (day - 81) * Math.PI / 180;
  const EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // in minutes
  
  // Zenith angle for sunrise/sunset is 90.833 degrees
  const cosH = (Math.cos(90.833 * Math.PI / 180) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination));
  
  if (cosH < -1) {
    // Polar Day (sun never sets)
    return { sunriseUtc: "Polar Day", sunsetUtc: "Polar Day" };
  }
  if (cosH > 1) {
    // Polar Night (sun never rises)
    return { sunriseUtc: "Polar Night", sunsetUtc: "Polar Night" };
  }
  
  const H = Math.acos(cosH) * 180 / Math.PI; // in degrees
  
  // Sunrise & Sunset in UTC (decimal hours)
  const sunriseUtc = 12 - (lon / 15) - (EoT / 60) - (H / 15);
  const sunsetUtc = 12 - (lon / 15) - (EoT / 60) + (H / 15);
  
  return { sunriseUtc, sunsetUtc };
};

// Formats a UTC decimal hour into timezone-local time format
const formatSolarTime = (utcDecimalHour, date, timezone) => {
  if (typeof utcDecimalHour === 'string') return utcDecimalHour; // e.g. "Polar Day"
  
  const hours = Math.floor(utcDecimalHour);
  const mins = Math.floor((utcDecimalHour - hours) * 60);
  
  // Create a UTC date representing this event today
  const eventDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    mins,
    0
  ));
  
  try {
    return eventDate.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    const pad = (n) => n.toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const dispHours = hours % 12 || 12;
    return `${dispHours}:${pad(mins)} ${ampm}`;
  }
};

// Generates mathematically precise vector moon phase SVG.
// Northern Hemisphere orientation: waxing lit on RIGHT (D-shape), waning lit on LEFT (C-shape).
// Arc 1 traces the RIGHT limb (counter-clockwise, sweep=0) top to bottom.
// Arc 2 is the terminator: sweep=0 (waxing, right stays lit), sweep=1 (waning, left stays lit).
const drawSvgMoonPhase = (phase) => {
  const r = 20;
  const cx = 25;
  const cy = 25;
  
  if (phase < 0.02 || phase > 0.98) {
    // New Moon: completely dark
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="black" stroke-width="2" />
            <circle cx="${cx}" cy="${cy}" r="${r - 1.5}" fill="black" />`;
  }
  if (phase > 0.48 && phase < 0.52) {
    // Full Moon: completely lit
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="black" stroke-width="2" />`;
  }
  
  // xRatio: cos(2π·phase) gives terminator ellipse x-radius as fraction of r.
  // sweepLit=0 (waxing): terminator curves left, keeping right side white (D-shape).
  // sweepLit=1 (waning): terminator curves right, keeping left side white (C-shape).
  const xRatio = Math.cos(2 * Math.PI * phase);
  const sweepLit = phase < 0.5 ? 0 : 1;
  const pathD = `M ${cx} ${cy - r}
                 A ${r} ${r} 0 0 0 ${cx} ${cy + r}
                 A ${r * Math.abs(xRatio)} ${r} 0 0 ${sweepLit} ${cx} ${cy - r}`;
  
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="black" stroke="black" stroke-width="1.5" />
    <path d="${pathD}" fill="white" stroke="none" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="black" stroke-width="1.5" />
  `;
};

module.exports = {
  id: "world_clock",
  name: "World Sun & Moon Clock",
  description: "A Greenwich-centered day/night world map displaying apparent Sun & Moon points, local timezone times, and solar/lunar phases.",
  configFields: [
    { key: "timezone", label: "Local Timezone", type: "text", default: "Europe/London" },
    { key: "latitude", label: "Station Latitude", type: "number", default: 51.5074 },
    { key: "longitude", label: "Station Longitude", type: "number", default: -0.1278 },
    { key: "mapStyle", label: "Map Render Style", type: "select", default: "hires", options: ["hires", "solid", "dots"] },
    { key: "label", label: "Clock Title", type: "text", default: "World Clock" }
  ],

  async fetchData(settings, device = {}) {
    const lat = parseFloat(settings.latitude !== undefined ? settings.latitude : 51.5074);
    const lon = parseFloat(settings.longitude !== undefined ? settings.longitude : -0.1278);
    const timezone = settings.timezone || "Europe/London";
    const label = settings.label || "World Clock";

    const date = new Date();
    
    // Solar & Lunar Positions
    const sunPos = getSubsolarPoint(date);
    const moonPos = getMoonDetails(date);
    
    // Sunrise / Sunset calculations
    const solarEvents = calculateSunriseSunset(lat, lon, date);
    const sunriseStr = formatSolarTime(solarEvents.sunriseUtc, date, timezone);
    const sunsetStr = formatSolarTime(solarEvents.sunsetUtc, date, timezone);

    let daylightStr = "";
    if (typeof solarEvents.sunriseUtc === 'number' && typeof solarEvents.sunsetUtc === 'number') {
      const diffDecimal = solarEvents.sunsetUtc - solarEvents.sunriseUtc;
      const hours = Math.floor(diffDecimal);
      const mins = Math.round((diffDecimal - hours) * 60);
      daylightStr = `${hours}h ${mins}m`;
    } else {
      daylightStr = solarEvents.sunriseUtc; // e.g. "Polar Day" or "Polar Night"
    }

    // Formatted Local clock parameters
    let localTime = "";
    let localDate = "";
    try {
      localTime = date.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
      localDate = date.toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      localTime = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      localDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // Formatted Greenwich clock parameters
    const gmtTime = date.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
    const gmtDate = date.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });

    return {
      label,
      timezone,
      latitude: lat,
      longitude: lon,
      localTime,
      localDate,
      gmtTime,
      gmtDate,
      sunrise: sunriseStr,
      sunset: sunsetStr,
      daylight: daylightStr,
      sun: sunPos,
      moon: moonPos,
      mapStyle: settings.mapStyle || "hires"
    };
  },

  renderSVG(data, width, height, ditherMode = 'floyd-steinberg') {
    const isFullScreen = width > 500;
    
    // Shaded overlay for the night shadow (using opacity for premium look)

    const mapWidthCells = 60;
    const mapHeightCells = 20;

    let dx = 6;
    let dy = 8;
    let mapX = 20;
    let mapY = 15; // Shifted up for small screens too

    if (isFullScreen) {
      dx = 12.5;
      dy = 17;
      mapX = 25;
      mapY = 15; // Shifted up to top edge
    }

    const mapWidth = mapWidthCells * dx;
    const mapHeight = mapHeightCells * dy;

    // Grid dots/solid pixels rendering loop
    let dotsHtml = '';
    const mapStyle = data.mapStyle || 'hires';
    
    if (mapStyle === 'hires') {
      if (mapBase64) {
        dotsHtml += `<image xlink:href="data:image/png;base64,${mapBase64}" href="data:image/png;base64,${mapBase64}" x="${mapX}" y="${mapY}" width="${mapWidth}" height="${mapHeight}" />`;
      } else {
        dotsHtml += `<rect x="${mapX}" y="${mapY}" width="${mapWidth}" height="${mapHeight}" fill="none" stroke="black" stroke-width="1.5" />`;
        dotsHtml += `<text x="${mapX + mapWidth / 2}" y="${mapY + mapHeight / 2}" font-family="sans-serif" font-size="12" fill="black" text-anchor="middle">Map Background Missing</text>`;
      }

      // Generate smooth terminator polygon points
      const points = [];
      const delta = data.sun.latitude;
      const deltaRad = delta * Math.PI / 180;
      const sunLonRad = data.sun.longitude * Math.PI / 180;
      
      const tanDelta = Math.tan(deltaRad);
      const divisor = Math.abs(tanDelta) < 1e-6 ? 1e-6 * Math.sign(tanDelta || 1) : tanDelta;

      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const lambda = -180 + (i / steps) * 360;
        const lambdaRad = lambda * Math.PI / 180;
        
        const phiRad = Math.atan(-Math.cos(lambdaRad - sunLonRad) / divisor);
        const phi = phiRad * 180 / Math.PI;
        
        const px = mapX + (i / steps) * mapWidth;
        const py = mapY + ((90 - phi) / 180) * mapHeight;
        points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      }

      // Close polygon based on season (solar declination)
      if (delta >= 0) {
        points.push(`${(mapX + mapWidth).toFixed(1)},${(mapY + mapHeight).toFixed(1)}`);
        points.push(`${mapX.toFixed(1)},${(mapY + mapHeight).toFixed(1)}`);
      } else {
        points.push(`${(mapX + mapWidth).toFixed(1)},${mapY.toFixed(1)}`);
        points.push(`${mapX.toFixed(1)},${mapY.toFixed(1)}`);
      }

      const terminatorPoints = points.join(' ');

      // Night shadow opacity: 1-bit dithered screens (floyd-steinberg / threshold / bayer)
      // use a much lighter overlay so the sea dither pattern stays visibly distinct from land.
      // 4-gray and preview screens can handle a slightly stronger shadow.
      const is1Bit = !ditherMode || ditherMode === 'floyd-steinberg' || ditherMode === 'threshold' ||
                     ditherMode === 'atkinson' || ditherMode.startsWith('bayer');
      const nightOpacity = is1Bit ? 0.28 : 0.15;
      dotsHtml += `<polygon points="${terminatorPoints}" fill="black" fill-opacity="${nightOpacity}" />`;
      dotsHtml += `<rect x="${mapX}" y="${mapY}" width="${mapWidth}" height="${mapHeight}" fill="none" stroke="black" stroke-width="1.5" />`;
    } else {
      for (let y = 0; y < mapHeightCells; y++) {
        const phi = 90 - (y + 0.5) * (180 / mapHeightCells);
        const phiRad = phi * Math.PI / 180;
        
        for (let x = 0; x < mapWidthCells; x++) {
          const char = MAP_GRID[y][x];
          const isLand = char === '#';
          
          if (mapStyle === 'dots' && !isLand) continue;
          
          const lambda = (x - 30) * (360 / mapWidthCells);
          
          // Solar zenith distance
          const sunLatRad = data.sun.latitude * Math.PI / 180;
          const sunLonRad = data.sun.longitude * Math.PI / 180;
          const lambdaRad = lambda * Math.PI / 180;
          
          const cosTheta = Math.sin(phiRad) * Math.sin(sunLatRad) + 
                           Math.cos(phiRad) * Math.cos(sunLatRad) * Math.cos(lambdaRad - sunLonRad);
          
          const isDay = cosTheta >= 0;
          
          const cx = mapX + x * dx;
          const cy = mapY + y * dy;
          
          if (mapStyle === 'dots') {
            if (isDay) {
              dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${dx * 0.38}" fill="black" />`;
            } else {
              dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${dx * 0.35}" fill="none" stroke="black" stroke-width="1" />`;
            }
          } else {
            // mapStyle === 'solid'
            const pxW = dx + 0.5;
            const pxH = dy + 0.5;
            const rx = cx - dx / 2;
            const ry = cy - dy / 2;

            if (isLand) {
              if (isDay) {
                dotsHtml += `<rect x="${rx}" y="${ry}" width="${pxW}" height="${pxH}" fill="black" />`;
              } else {
                // Night Land: checkerboard pattern for high-contrast dither-free rendering
                if ((x + y) % 2 === 0) {
                  dotsHtml += `<rect x="${rx}" y="${ry}" width="${pxW}" height="${pxH}" fill="black" />`;
                }
              }
            } else {
              if (!isDay) {
                // Night Water left white for E-Ink contrast
              }
            }
          }
        }
      }
    }

    // Convert apparent latitude/longitude to grid coordinates
    const getMapCoords = (lat, lon) => {
      let x = 30 + lon / (360 / mapWidthCells);
      let y = (90 - lat) / (180 / mapHeightCells);
      
      return {
        cx: mapX + x * dx,
        cy: mapY + y * dy
      };
    };

    const sunCoords = getMapCoords(data.sun.latitude, data.sun.longitude);
    const moonCoords = getMapCoords(data.moon.latitude, data.moon.longitude);

    // Apparent Sun Icon
    const sunIconHtml = `
      <g transform="translate(${sunCoords.cx - 8}, ${sunCoords.cy - 8})">
        <circle cx="8" cy="8" r="4.5" fill="white" stroke="black" stroke-width="1.8" />
        <line x1="8" y1="1" x2="8" y2="3" stroke="black" stroke-width="1.2" stroke-linecap="round" />
        <line x1="8" y1="13" x2="8" y2="15" stroke="black" stroke-width="1.2" stroke-linecap="round" />
        <line x1="1" y1="8" x2="3" y2="8" stroke="black" stroke-width="1.2" stroke-linecap="round" />
        <line x1="13" y1="8" x2="15" y2="8" stroke="black" stroke-width="1.2" stroke-linecap="round" />
      </g>
    `;

    // Apparent Moon Icon
    const moonIconHtml = `
      <g transform="translate(${moonCoords.cx - 8}, ${moonCoords.cy - 8})">
        <circle cx="8" cy="8" r="4.5" fill="black" stroke="black" stroke-width="1" />
        <path d="M 8 3.5 A 4.5 4.5 0 0 1 8 12.5 A 4.5 4.5 0 0 0 8 3.5" fill="white" />
      </g>
    `;

    const moonPhaseDrawing = drawSvgMoonPhase(data.moon.phase);

    if (isFullScreen) {
      return `
        <g>
          <!-- Rendered Dot World Map -->
          ${dotsHtml}
          
          <!-- Apparent Plotted Elements -->
          ${sunIconHtml}
          ${moonIconHtml}
          
          <!-- Bottom Telemetry Bar Divider -->
          <line x1="20" y1="395" x2="${width - 20}" y2="395" stroke="black" stroke-width="1.5" />

          <!-- Bottom Telemetry Column 1: Date & Daylight -->
          <text x="180" y="420" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" text-anchor="middle">DATE</text>
          <text x="180" y="445" font-family="sans-serif" font-size="15" font-weight="bold" fill="black" text-anchor="middle">${escapeXml(data.localDate)}</text>
          <text x="180" y="468" font-family="sans-serif" font-size="13" fill="black" text-anchor="middle">${escapeXml(data.daylight)} daylight</text>

          <!-- Bottom Telemetry Column 2: Sunrise & Sunset -->
          <text x="420" y="420" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" text-anchor="middle">SUN TIMES</text>
          <text x="420" y="445" font-family="sans-serif" font-size="14.5" fill="black" text-anchor="middle">↑ ${escapeXml(data.sunrise)}</text>
          <text x="420" y="468" font-family="sans-serif" font-size="14.5" fill="black" text-anchor="middle">↓ ${escapeXml(data.sunset)}</text>

          <!-- Bottom Telemetry Column 3: Moon Phase -->
          <text x="620" y="420" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" text-anchor="middle">MOON PHASE</text>
          <g transform="translate(607.5, 428) scale(0.5)">
            ${moonPhaseDrawing}
          </g>
          <text x="620" y="468" font-family="sans-serif" font-size="13" fill="black" text-anchor="middle">${escapeXml(data.moon.phaseName)}</text>
        </g>
      `;
    } else {
      const isShort = height < 300;
      
      if (isShort) {
        return `
          <g>
            <g transform="translate(-10, -5) scale(0.95)">
              ${dotsHtml}
              ${sunIconHtml}
              ${moonIconHtml}
            </g>
            
            <line x1="10" y1="195" x2="${width - 10}" y2="195" stroke="black" stroke-width="1.2" />
            <text x="20" y="215" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="black">${escapeXml(data.localDate.toUpperCase())} | DL: ${escapeXml(data.daylight)}</text>
            <text x="${width - 20}" y="215" font-family="sans-serif" font-size="10.5" fill="black" text-anchor="end">SR: ${escapeXml(data.sunrise)}  SS: ${escapeXml(data.sunset)}</text>
            
            <g transform="translate(12, 6)" stroke="black" stroke-width="1.2" fill="none">
              <circle cx="7" cy="7" r="6" />
              <path d="M 1 7 H 13" />
              <path d="M 7 1 A 6 6 0 0 0 7 13 A 6 6 0 0 0 7 1" />
              <path d="M 7 1 A 10 6 0 0 0 7 13 A 10 6 0 0 0 7 1" />
            </g>
            <text x="32" y="18" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">${escapeXml(data.label.toUpperCase())}</text>
          </g>
        `;
      } else {
        return `
          <g>
            <g transform="translate(15, 10)" stroke="black" stroke-width="1.5" fill="none">
              <circle cx="8" cy="8" r="7" />
              <path d="M 1 8 H 15" />
              <path d="M 8 1 A 7 7 0 0 0 8 15 A 7 7 0 0 0 8 1" />
              <path d="M 8 1 A 12 7 0 0 0 8 15 A 12 7 0 0 0 8 1" />
            </g>
            <text x="37" y="25" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${escapeXml(data.label.toUpperCase())}</text>
            <text x="${width - 15}" y="24" font-family="sans-serif" font-size="9" fill="black" opacity="0.6" text-anchor="end">0° GREENWICH</text>
            
            <g transform="translate(10, 15)">
              ${dotsHtml}
              ${sunIconHtml}
              ${moonIconHtml}
            </g>
            
            <line x1="15" y1="225" x2="${width - 15}" y2="225" stroke="black" stroke-width="1.5" />
            
            <!-- Bottom Telemetry Column 1: Date & Daylight -->
            <text x="20" y="248" font-family="sans-serif" font-size="11" font-weight="bold" fill="black">${escapeXml(data.localDate.toUpperCase())}</text>
            <text x="20" y="268" font-family="sans-serif" font-size="10.5" fill="black">Daylight: ${escapeXml(data.daylight)}</text>
            
            <!-- Bottom Telemetry Column 2: Sunrise & Sunset -->
            <text x="160" y="248" font-family="sans-serif" font-size="10.5" fill="black">Sunrise: <tspan font-weight="bold">${escapeXml(data.sunrise)}</tspan></text>
            <text x="160" y="268" font-family="sans-serif" font-size="10.5" fill="black">Sunset: <tspan font-weight="bold">${escapeXml(data.sunset)}</tspan></text>
            
            <!-- Bottom Telemetry Column 3: Moon Phase -->
            <g transform="translate(285, 230) scale(0.6)">
              ${moonPhaseDrawing}
            </g>
            <text x="325" y="246" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="black">${escapeXml(data.moon.phaseName.toUpperCase())}</text>
            <text x="325" y="262" font-family="sans-serif" font-size="9" fill="black">Age: ${data.moon.age.toFixed(1)}d</text>
          </g>
        `;
      }
    }
  }
};
