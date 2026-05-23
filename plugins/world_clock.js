// world_clock.js - Greenwich-Centered Day/Night World Map & Apparent Sun/Moon Coordinates
const fs = require('fs');
const path = require('path');

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
  if (age < 1.845) { phaseName = "New Moon"; icon = "🌑"; }
  else if (age < 5.536) { phaseName = "Waxing Crescent"; icon = "🌒"; }
  else if (age < 9.228) { phaseName = "First Quarter"; icon = "🌓"; }
  else if (age < 12.920) { phaseName = "Waxing Gibbous"; icon = "🌔"; }
  else if (age < 16.610) { phaseName = "Full Moon"; icon = "🌕"; }
  else if (age < 20.300) { phaseName = "Waning Gibbous"; icon = "🌖"; }
  else if (age < 23.990) { phaseName = "Third Quarter"; icon = "🌗"; }
  else if (age < 27.680) { phaseName = "Waning Crescent"; icon = "🌘"; }
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
    return eventDate.toLocaleTimeString('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (e) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(mins)}`;
  }
};

// Generates mathematically precise vector moon phase SVG
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
  
  // Calculate terminator curve horizontal axis ratio
  const xRatio = Math.cos(2 * Math.PI * phase);
  const sweepLit = phase < 0.5 ? 1 : 0;
  const pathD = `M ${cx} ${cy - r}
                 A ${r} ${r} 0 0 1 ${cx} ${cy + r}
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
    { key: "label", label: "Clock Title", type: "text", default: "Greenwich Meridian Clock" }
  ],

  async fetchData(settings, device = {}) {
    const lat = parseFloat(settings.latitude !== undefined ? settings.latitude : 51.5074);
    const lon = parseFloat(settings.longitude !== undefined ? settings.longitude : -0.1278);
    const timezone = settings.timezone || "Europe/London";
    const label = settings.label || "Greenwich Meridian Clock";

    const date = new Date();
    
    // Solar & Lunar Positions
    const sunPos = getSubsolarPoint(date);
    const moonPos = getMoonDetails(date);
    
    // Sunrise / Sunset calculations
    const solarEvents = calculateSunriseSunset(lat, lon, date);
    const sunriseStr = formatSolarTime(solarEvents.sunriseUtc, date, timezone);
    const sunsetStr = formatSolarTime(solarEvents.sunsetUtc, date, timezone);

    // Formatted Local clock parameters
    let localTime = "";
    let localDate = "";
    try {
      localTime = date.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
      localDate = date.toLocaleDateString('en-GB', { timeZone: timezone, weekday: 'short', day: '2-digit', month: 'short' });
    } catch (e) {
      localTime = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      localDate = date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
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
      sun: sunPos,
      moon: moonPos
    };
  },

  renderSVG(data, width, height) {
    const isFullScreen = width > 500;
    
    const mapWidthCells = 60;
    const mapHeightCells = 20;

    let dx = 6;
    let dy = 8;
    let mapX = 20;
    let mapY = 50;

    if (isFullScreen) {
      dx = 8.5;
      dy = 11.5;
      mapX = 250;
      mapY = 110;
    }

    // Grid dots rendering loop
    let dotsHtml = '';
    
    for (let y = 0; y < mapHeightCells; y++) {
      const phi = 90 - (y + 0.5) * (180 / mapHeightCells);
      const phiRad = phi * Math.PI / 180;
      
      for (let x = 0; x < mapWidthCells; x++) {
        const char = MAP_GRID[y][x];
        if (char !== '#') continue;
        
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
        
        if (isDay) {
          dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${dx * 0.38}" fill="black" />`;
        } else {
          dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${dx * 0.35}" fill="none" stroke="black" stroke-width="1" opacity="0.45" />`;
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
          <!-- Left Telemetry Panel -->
          <rect x="15" y="65" width="210" height="395" rx="8" fill="none" stroke="black" stroke-width="1.5" />
          
          <!-- Local Time Section -->
          <text x="30" y="105" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.6">LOCAL TIME</text>
          <text x="30" y="152" font-family="monospace" font-size="42" font-weight="bold" fill="black" letter-spacing="-1">${escapeXml(data.localTime)}</text>
          <text x="30" y="178" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${escapeXml(data.localDate.toUpperCase())}</text>
          
          <line x1="30" y1="195" x2="210" y2="195" stroke="black" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" />
          
          <!-- Local Sunrise/Sunset Section -->
          <g transform="translate(30, 212)">
            <text x="0" y="0" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" opacity="0.6">SOLAR INTERVALS</text>
            
            <!-- Sunrise Row -->
            <path d="M 0 16 L 14 16 M 7 9 L 7 15 M 4 12 L 10 12" stroke="black" stroke-width="1.2" stroke-linecap="round" />
            <text x="22" y="21" font-family="sans-serif" font-size="12" fill="black" opacity="0.75">Sunrise:</text>
            <text x="180" y="21" font-family="sans-serif" font-size="12.5" font-weight="bold" fill="black" text-anchor="end">${escapeXml(data.sunrise)}</text>
            
            <!-- Sunset Row -->
            <path d="M 0 42 L 14 42 M 7 47 L 7 41 M 4 44 L 10 44" stroke="black" stroke-width="1.2" stroke-linecap="round" />
            <text x="22" y="47" font-family="sans-serif" font-size="12" fill="black" opacity="0.75">Sunset:</text>
            <text x="180" y="47" font-family="sans-serif" font-size="12.5" font-weight="bold" fill="black" text-anchor="end">${escapeXml(data.sunset)}</text>
          </g>
          
          <line x1="30" y1="285" x2="210" y2="285" stroke="black" stroke-width="1" stroke-dasharray="2,2" opacity="0.3" />
          
          <!-- Moon Phase Section -->
          <g transform="translate(30, 305)">
            <text x="0" y="0" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" opacity="0.6">LUNAR INTERACTIVE</text>
            
            <g transform="translate(0, 15)">
              ${moonPhaseDrawing}
            </g>
            
            <text x="60" y="32" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${escapeXml(data.moon.phaseName.toUpperCase())}</text>
            <text x="60" y="48" font-family="sans-serif" font-size="11.5" fill="black" opacity="0.65">Age: ${data.moon.age.toFixed(1)} days</text>
          </g>
          
          <!-- Greenwich Header & Map Border -->
          <text x="250" y="85" font-family="sans-serif" font-size="15" font-weight="bold" fill="black" letter-spacing="1">🌎 WORLD DAY/NIGHT &amp; CELESTIAL POSITION</text>
          <line x1="250" y1="95" x2="${width - 20}" y2="95" stroke="black" stroke-width="2" />
          
          <!-- Rendered Dot World Map -->
          ${dotsHtml}
          
          <!-- Apparent Plotted Elements -->
          ${sunIconHtml}
          ${moonIconHtml}
          
          <!-- GMT Info -->
          <g transform="translate(${width - 20}, ${height - 25})">
            <text x="0" y="0" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" opacity="0.5" text-anchor="end">GREENWICH MEAN TIME (GMT): ${escapeXml(data.gmtTime)} | ${escapeXml(data.gmtDate)}</text>
          </g>
          
          <!-- Map Legend -->
          <g transform="translate(250, ${height - 25})">
            <circle cx="5" cy="-4" r="3.5" fill="black" />
            <text x="14" y="0" font-family="sans-serif" font-size="10" fill="black" opacity="0.65">Daylight</text>
            
            <circle cx="75" cy="-4" r="3" fill="none" stroke="black" stroke-width="1" opacity="0.5" />
            <text x="84" y="0" font-family="sans-serif" font-size="10" fill="black" opacity="0.65">Nighttime</text>
            
            <circle cx="160" cy="-4" r="3" fill="white" stroke="black" stroke-width="1.2" />
            <text x="169" y="0" font-family="sans-serif" font-size="10" fill="black" opacity="0.65">Sun</text>
            
            <circle cx="215" cy="-4" r="3" fill="black" />
            <path d="M 215 -8.5 A 4.5 4.5 0 0 1 215 .5 A 4.5 4.5 0 0 0 215 -8.5" fill="white" />
            <text x="224" y="0" font-family="sans-serif" font-size="10" fill="black" opacity="0.65">Moon</text>
          </g>
          
          <!-- Header Bar -->
          <rect x="0" y="0" width="${width}" height="52" fill="black" />
          <text x="20" y="34" font-family="sans-serif" font-size="20" font-weight="bold" fill="white" letter-spacing="1.5">🌍 ${escapeXml(data.label.toUpperCase())}</text>
          <text x="${width - 20}" y="32" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="white" text-anchor="end" letter-spacing="1">MERIDIAN CENTERED MAP</text>
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
            
            <rect x="10" y="195" width="${width - 20}" height="38" rx="4" fill="black" />
            <text x="20" y="219" font-family="monospace" font-size="15" font-weight="bold" fill="white">${escapeXml(data.localTime)}</text>
            <text x="75" y="218" font-family="sans-serif" font-size="10" fill="white" opacity="0.8">${escapeXml(data.localDate.toUpperCase())} | TZ: ${escapeXml(data.timezone)}</text>
            <text x="${width - 20}" y="218" font-family="sans-serif" font-size="10" fill="white" text-anchor="end" opacity="0.95">🌅 ${escapeXml(data.sunrise)}  🌇 ${escapeXml(data.sunset)}</text>
            
            <rect x="0" y="0" width="${width}" height="32" fill="black" />
            <text x="12" y="21" font-family="sans-serif" font-size="13" font-weight="bold" fill="white">🌍 ${escapeXml(data.label.toUpperCase())}</text>
          </g>
        `;
      } else {
        return `
          <g>
            <rect x="0" y="0" width="${width}" height="42" fill="black" />
            <text x="15" y="27" font-family="sans-serif" font-size="15" font-weight="bold" fill="white">🌍 ${escapeXml(data.label.toUpperCase())}</text>
            <text x="${width - 15}" y="26" font-family="sans-serif" font-size="10" fill="white" text-anchor="end" opacity="0.8">0° GREENWICH</text>
            
            <g transform="translate(10, 10)">
              ${dotsHtml}
              ${sunIconHtml}
              ${moonIconHtml}
            </g>
            
            <line x1="15" y1="230" x2="${width - 15}" y2="230" stroke="black" stroke-width="1.5" />
            
            <g transform="translate(20, 255)">
              <text x="0" y="0" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" opacity="0.6">LOCAL TIME</text>
              <text x="0" y="42" font-family="monospace" font-size="36" font-weight="bold" fill="black">${escapeXml(data.localTime)}</text>
              <text x="0" y="62" font-family="sans-serif" font-size="12" font-weight="bold" fill="black">${escapeXml(data.localDate.toUpperCase())} (${escapeXml(data.timezone)})</text>
              
              <g transform="translate(0, 85)">
                <text x="0" y="0" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" opacity="0.6">SUNRISE &amp; SUNSET</text>
                <text x="0" y="22" font-family="sans-serif" font-size="12" fill="black" opacity="0.85">🌅 Sunrise: <tspan font-weight="bold">${escapeXml(data.sunrise)}</tspan></text>
                <text x="180" y="22" font-family="sans-serif" font-size="12" fill="black" opacity="0.85">🌇 Sunset: <tspan font-weight="bold">${escapeXml(data.sunset)}</tspan></text>
              </g>
              
              <g transform="translate(0, 142)">
                <text x="0" y="0" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" opacity="0.6">LUNAR INTERACTIVE</text>
                <g transform="translate(0, 10)">
                  ${moonPhaseDrawing}
                </g>
                <text x="55" y="28" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${escapeXml(data.moon.phaseName.toUpperCase())}</text>
                <text x="55" y="44" font-family="sans-serif" font-size="11" fill="black" opacity="0.7">Age: ${data.moon.age.toFixed(1)} days</text>
              </g>
            </g>
            
            <rect x="0" y="${height - 30}" width="${width}" height="30" fill="black" />
            <text x="15" y="${height - 11}" font-family="sans-serif" font-size="10" font-weight="bold" fill="white">GMT: ${escapeXml(data.gmtTime)} | ${escapeXml(data.gmtDate)}</text>
          </g>
        `;
      }
    }
  }
};
