// lunar_calendar.js - Dynamic Lunar Calendar E-Ink Widget
const https = require('https');
const http = require('http');

const escapeXml = (unsafe) => {
  return (unsafe || "")
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
      options.rejectUnauthorized = false; // Bypass certificate chain validation issues
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

const getLunarAge = (date) => {
  // Astronomical reference: New Moon on Jan 6, 2000 at 18:14 UTC
  const epoch = Date.UTC(2000, 0, 6, 18, 14, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = (date.getTime() - epoch) / msPerDay;
  const synodicMonth = 29.530588853;
  let age = diffDays % synodicMonth;
  if (age < 0) age += synodicMonth;
  return age;
};

const getMoonIllumination = (age) => {
  const phase = age / 29.530588853;
  const angle = phase * 2 * Math.PI;
  return (1 - Math.cos(angle)) / 2;
};

const getMoonPhaseName = (age) => {
  const phase = age / 29.530588853;
  if (phase < 0.03 || phase > 0.97) return "New Moon";
  if (phase >= 0.03 && phase < 0.22) return "Waxing Crescent";
  if (phase >= 0.22 && phase < 0.28) return "First Quarter";
  if (phase >= 0.28 && phase < 0.47) return "Waxing Gibbous";
  if (phase >= 0.47 && phase < 0.53) return "Full Moon";
  if (phase >= 0.53 && phase < 0.72) return "Waning Gibbous";
  if (phase >= 0.72 && phase < 0.78) return "Third Quarter";
  if (phase >= 0.78 && phase <= 0.97) return "Waning Crescent";
  return "New Moon";
};

const getAgeDiff = (age1, age2, synodic) => {
  let diff = Math.abs(age1 - age2);
  return Math.min(diff, synodic - diff);
};

const getLunarCalendarDays = (currentDate) => {
  const synodic = 29.530588853;
  const targets = [
    { name: "New Moon", age: 0 },
    { name: "Waxing Crescent", age: synodic * 0.125 },
    { name: "First Quarter", age: synodic * 0.25 },
    { name: "Waxing Gibbous", age: synodic * 0.375 },
    { name: "Full Moon", age: synodic * 0.5 },
    { name: "Waning Gibbous", age: synodic * 0.625 },
    { name: "Third Quarter", age: synodic * 0.75 },
    { name: "Waning Crescent", age: synodic * 0.875 }
  ];

  const events = [];
  const days = [];
  for (let i = -22; i <= 22; i++) {
    const d = new Date(currentDate.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    d.setUTCHours(12, 0, 0, 0);
    const age = getLunarAge(d);
    days.push({ date: d, age });
  }

  targets.forEach(t => {
    for (let idx = 1; idx < days.length - 1; idx++) {
      const prevDiff = getAgeDiff(days[idx-1].age, t.age, synodic);
      const currDiff = getAgeDiff(days[idx].age, t.age, synodic);
      const nextDiff = getAgeDiff(days[idx+1].age, t.age, synodic);

      if (currDiff < prevDiff && currDiff < nextDiff) {
        events.push({
          name: t.name,
          date: new Date(days[idx].date.getTime()),
          age: days[idx].age,
          phase: t.age / synodic
        });
      }
    }
  });

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  const uniqueEvents = [];
  const seenDates = new Set();
  events.forEach(e => {
    const dateStr = e.date.toISOString().split('T')[0];
    if (!seenDates.has(dateStr)) {
      seenDates.add(dateStr);
      uniqueEvents.push(e);
    }
  });

  let closestIdx = 0;
  let minTimeDiff = Infinity;
  uniqueEvents.forEach((e, idx) => {
    const timeDiff = Math.abs(e.date.getTime() - currentDate.getTime());
    if (timeDiff < minTimeDiff) {
      minTimeDiff = timeDiff;
      closestIdx = idx;
    }
  });

  let startIdx = closestIdx - 3;
  let endIdx = closestIdx + 3;

  if (startIdx < 0) {
    startIdx = 0;
    endIdx = Math.min(6, uniqueEvents.length - 1);
  }
  if (endIdx >= uniqueEvents.length) {
    endIdx = uniqueEvents.length - 1;
    startIdx = Math.max(0, endIdx - 6);
  }

  const columns = uniqueEvents.slice(startIdx, endIdx + 1);

  // Center column is always Today
  if (columns.length === 7) {
    const todayAge = getLunarAge(currentDate);
    const todayPhase = todayAge / synodic;
    columns[3] = {
      name: getMoonPhaseName(todayAge),
      date: new Date(currentDate.getTime()),
      age: todayAge,
      phase: todayPhase,
      isToday: true
    };
  }

  return columns;
};

const getNextMoonEvents = (currentDate) => {
  const synodic = 29.530588853;
  const events = [];
  const days = [];
  for (let i = 0; i <= 35; i++) {
    const d = new Date(currentDate.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    d.setUTCHours(12, 0, 0, 0);
    const age = getLunarAge(d);
    days.push({ date: d, age });
  }

  const qMarks = [
    { name: "New Moon", target: 0 },
    { name: "First Quarter", target: synodic * 0.25 },
    { name: "Full Moon", target: synodic * 0.5 },
    { name: "Third Quarter", target: synodic * 0.75 }
  ];

  qMarks.forEach(qm => {
    for (let idx = 1; idx < days.length - 1; idx++) {
      const prevDiff = getAgeDiff(days[idx-1].age, qm.target, synodic);
      const currDiff = getAgeDiff(days[idx].age, qm.target, synodic);
      const nextDiff = getAgeDiff(days[idx+1].age, qm.target, synodic);

      if (currDiff < prevDiff && currDiff < nextDiff) {
        events.push({
          name: qm.name,
          date: new Date(days[idx].date.getTime()),
          age: days[idx].age
        });
      }
    }
  });

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  const nextNewMoon = events.find(e => e.name === "New Moon");
  const nextFullMoon = events.find(e => e.name === "Full Moon");
  
  const nextQuarter = events.find(e => {
    const eDate = new Date(e.date.getTime());
    eDate.setHours(0,0,0,0);
    const cDate = new Date(currentDate.getTime());
    cDate.setHours(0,0,0,0);
    return eDate.getTime() >= cDate.getTime();
  }) || events[0];

  return { nextNewMoon, nextFullMoon, nextQuarter };
};

const fs = require('fs');
const path = require('path');

const getBase64MoonPhase = (phase) => {
  if (phase < 0.02 || phase > 0.98) {
    return null; // New Moon
  }
  const idx = Math.min(22, Math.max(0, Math.floor((phase - 0.02) / (0.96 / 23))));
  const imgPath = path.join(__dirname, '..', 'public', 'moon_phases', `moon_phase_${idx}.png`);
  if (fs.existsSync(imgPath)) {
    return fs.readFileSync(imgPath).toString('base64');
  }
  return null;
};

const drawSvgMoonPhase = (phase, cx, cy, r) => {
  const base64 = getBase64MoonPhase(phase);
  if (!base64) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="black" stroke="black" stroke-width="1.5" />`;
  }
  
  const clipId = `moonClip-${Math.floor(cx)}-${Math.floor(cy)}`;
  return `
    <defs>
      <clipPath id="${clipId}">
        <circle cx="${cx}" cy="${cy}" r="${r}" />
      </clipPath>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="black" />
    <image x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" href="data:image/png;base64,${base64}" clip-path="url(#${clipId})" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="black" stroke-width="1.5" />
  `;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatDateShort = (date) => {
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')}`;
};

module.exports = {
  id: "lunar_calendar",
  name: "Lunar Calendar",
  description: "Displays current moon phase details, a weekly calendar timeline, and next phase events based on geocoded location.",
  configFields: [
    { key: "postcode", label: "UK or Global Postal Code (Optional)", type: "text", default: "" },
    { key: "latitude", label: "Latitude", type: "number", default: 51.5074 },
    { key: "longitude", label: "Longitude", type: "number", default: -0.1278 },
    { key: "timezone", label: "Timezone", type: "text", default: "Europe/London" }
  ],

  async fetchData(settings, device) {
    let lat = settings.latitude !== undefined ? parseFloat(settings.latitude) : 51.5074;
    let lon = settings.longitude !== undefined ? parseFloat(settings.longitude) : -0.1278;
    let locationName = "";

    // 1. Geocode postcode if provided
    if (settings.postcode && settings.postcode.trim() !== "") {
      const cleanPostcode = settings.postcode.trim();
      const postcodeQuery = encodeURIComponent(cleanPostcode);

      // Try postcodes.io (UK)
      try {
        const cleanUK = cleanPostcode.replace(/\s+/g, '').toUpperCase();
        const ukRes = await getJson(`https://api.postcodes.io/postcodes/${cleanUK}`);
        if (ukRes && ukRes.status === 200 && ukRes.result) {
          lat = parseFloat(ukRes.result.latitude);
          lon = parseFloat(ukRes.result.longitude);
          locationName = ukRes.result.admin_district || ukRes.result.parish || "";
          console.log(`[Lunar Calendar] Resolved UK postcode "${cleanPostcode}" to ${lat}, ${lon}`);
        }
      } catch (e) {
        // Fallback to global geocode
      }

      // Try OpenStreetMap Nominatim (Global)
      if (!locationName) {
        try {
          const globalRes = await getJson(`https://nominatim.openstreetmap.org/search?q=${postcodeQuery}&format=json&limit=1`);
          if (globalRes && globalRes.length > 0) {
            lat = parseFloat(globalRes[0].lat);
            lon = parseFloat(globalRes[0].lon);
            locationName = globalRes[0].display_name.split(',')[0] || "";
            console.log(`[Lunar Calendar] Resolved global postcode "${cleanPostcode}" via Nominatim to ${lat}, ${lon}`);
          }
        } catch (e) {
          console.error(`[Lunar Calendar] Failed global geocoding for "${cleanPostcode}":`, e.message);
        }
      }
    }

    // 2. Reverse geocode to get settlement name if not resolved yet
    if (!locationName) {
      try {
        const reverseRes = await getJson(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        if (reverseRes && reverseRes.address) {
          locationName = reverseRes.address.city || reverseRes.address.town || reverseRes.address.village || reverseRes.address.suburb || "";
        }
      } catch (e) {
        console.error("[Lunar Calendar] Reverse geocoding failed:", e.message);
      }
    }

    if (!locationName) {
      locationName = "Custom Location";
    }

    // 3. Resolve current timezone date
    const tz = settings.timezone || (device && device.sleepPeriodTimezone) || "Europe/London";
    let date = settings.mockDate ? new Date(settings.mockDate) : new Date();
    try {
      const options = { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(settings.mockDate ? new Date(settings.mockDate) : new Date());
      const y = parseInt(parts.find(p => p.type === 'year').value, 10);
      const m = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
      const d = parseInt(parts.find(p => p.type === 'day').value, 10);
      const hr = parseInt(parts.find(p => p.type === 'hour').value, 10);
      const min = parseInt(parts.find(p => p.type === 'minute').value, 10);
      const sec = parseInt(parts.find(p => p.type === 'second').value, 10);
      date = new Date(Date.UTC(y, m, d, hr, min, sec));
    } catch (e) {
      console.error("[Lunar Calendar] Timezone adjustment failed, using system time:", e);
    }

    // 4. Calculate current moon metrics
    const age = getLunarAge(date);
    const illumination = getMoonIllumination(age);
    const phaseName = getMoonPhaseName(age);
    const phase = age / 29.530588853;

    // 5. Generate 7 calendar columns
    const columns = getLunarCalendarDays(date);

    // 6. Generate next major moon events
    const nextEvents = getNextMoonEvents(date);

    return {
      lat,
      lon,
      locationName,
      age: parseFloat(age.toFixed(1)),
      illumination: parseFloat((illumination * 100).toFixed(1)),
      phaseName,
      phase,
      columns: columns.map(c => ({
        name: c.name,
        date: c.date.toISOString(),
        age: c.age,
        phase: c.phase,
        isToday: !!c.isToday
      })),
      nextNewMoon: nextEvents.nextNewMoon ? { date: nextEvents.nextNewMoon.date.toISOString() } : null,
      nextFullMoon: nextEvents.nextFullMoon ? { date: nextEvents.nextFullMoon.date.toISOString() } : null,
      nextQuarter: nextEvents.nextQuarter ? { name: nextEvents.nextQuarter.name, date: nextEvents.nextQuarter.date.toISOString() } : null
    };
  },

  renderSVG(data, width, height) {
    const padding = 20;
    const startX = 22;
    const colWidth = 96;
    const colGap = 14;

    const locStr = `${data.locationName} (${data.lat.toFixed(4)}°, ${data.lon.toFixed(4)}°)`;

    // 7 Columns calculations
    let columnsHtml = '';
    (data.columns || []).forEach((c, idx) => {
      const colCenter = startX + idx * 110 + colWidth / 2;
      const colDate = new Date(c.date);
      const moonDrawing = drawSvgMoonPhase(c.phase, colCenter, 265, 28);

      columnsHtml += `
        <!-- Column ${idx + 1} -->
        <g>
          ${c.isToday ? `
            <rect x="${colCenter - 32}" y="195" width="64" height="20" rx="4" fill="black" />
            <text x="${colCenter}" y="209" font-family="sans-serif" font-size="11" font-weight="bold" fill="white" text-anchor="middle">${formatDateShort(colDate)}</text>
          ` : `
            <text x="${colCenter}" y="209" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" text-anchor="middle">${formatDateShort(colDate)}</text>
          `}
          
          <!-- Moon Icon -->
          <g>
            ${moonDrawing}
          </g>

          <!-- Label -->
          <text x="${colCenter}" y="322" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" text-anchor="middle">${escapeXml(c.name)}</text>
        </g>
      `;
    });

    const nextQuarterDate = data.nextQuarter ? new Date(data.nextQuarter.date) : null;
    const nextFullMoonDate = data.nextFullMoon ? new Date(data.nextFullMoon.date) : null;
    const nextNewMoonDate = data.nextNewMoon ? new Date(data.nextNewMoon.date) : null;

    return `
      <g>
        <defs>
          <pattern id="dotPattern" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="2" height="2" fill="black" />
            <rect x="2" y="2" width="2" height="2" fill="black" />
          </pattern>
        </defs>

        <!-- Header -->
        <rect x="0" y="0" width="${width}" height="52" fill="black" />
        <g transform="translate(${padding}, 17)" fill="white">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79 3.2 1.28 5.79 3.87 7.07 7.07-.58.13-1.17.21-1.79.21z" transform="scale(0.85) translate(0, -2)" />
        </g>
        <text x="${padding + 22}" y="35" font-family="sans-serif" font-size="20" font-weight="bold" fill="white" letter-spacing="1">LUNAR CALENDAR</text>
        <text x="${width - padding}" y="34" font-family="sans-serif" font-size="11.5" font-weight="bold" fill="white" opacity="0.8" text-anchor="end">${escapeXml(locStr)}</text>

        <!-- Section 1: Current Telemetry Block -->
        <g transform="translate(${padding}, 75)">
          <!-- Current Phase -->
          <g>
            <rect x="0" y="0" width="8" height="42" fill="url(#dotPattern)" />
            <text x="18" y="22" font-family="sans-serif" font-size="24" font-weight="bold" fill="black">${escapeXml(data.phaseName)}</text>
            <text x="18" y="38" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.6">Current Phase</text>
          </g>

          <!-- Moon Illumination -->
          <g transform="translate(380, 0)">
            <rect x="0" y="0" width="8" height="42" fill="url(#dotPattern)" />
            <text x="18" y="22" font-family="sans-serif" font-size="24" font-weight="bold" fill="black">${data.illumination}%</text>
            <text x="18" y="38" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.6">Moon Illumination</text>
          </g>

          <!-- Lunar Age -->
          <g transform="translate(590, 0)">
            <rect x="0" y="0" width="8" height="42" fill="url(#dotPattern)" />
            <text x="18" y="22" font-family="sans-serif" font-size="24" font-weight="bold" fill="black">${data.age}d</text>
            <text x="18" y="38" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.6">Lunar Age</text>
          </g>
        </g>

        <!-- Separator 1 -->
        <line x1="${padding}" y1="145" x2="${width - padding}" y2="145" stroke="black" stroke-width="1.5" stroke-dasharray="3,3" />

        <!-- Section 2: 7 columns timeline -->
        <g>
          ${columnsHtml}
        </g>

        <!-- Separator 2 -->
        <line x1="${padding}" y1="345" x2="${width - padding}" y2="345" stroke="black" stroke-width="1.5" stroke-dasharray="3,3" />

        <!-- Section 3: Next Phase Details -->
        <g transform="translate(${padding}, 365)">
          <!-- Next Phase -->
          <g>
            <rect x="0" y="0" width="8" height="42" fill="url(#dotPattern)" />
            <text x="18" y="20" font-family="sans-serif" font-size="18" font-weight="bold" fill="black">${data.nextQuarter ? escapeXml(data.nextQuarter.name) : 'N/A'}</text>
            <text x="18" y="38" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.6">Next Phase (${nextQuarterDate ? formatDateShort(nextQuarterDate) : 'N/A'})</text>
          </g>

          <!-- Next Full Moon -->
          <g transform="translate(380, 0)">
            <rect x="0" y="0" width="8" height="42" fill="url(#dotPattern)" />
            <text x="18" y="20" font-family="sans-serif" font-size="18" font-weight="bold" fill="black">${nextFullMoonDate ? formatDateShort(nextFullMoonDate) : 'N/A'}</text>
            <text x="18" y="38" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.6">Next Full Moon</text>
          </g>

          <!-- Next New Moon -->
          <g transform="translate(590, 0)">
            <rect x="0" y="0" width="8" height="42" fill="url(#dotPattern)" />
            <text x="18" y="20" font-family="sans-serif" font-size="18" font-weight="bold" fill="black">${nextNewMoonDate ? formatDateShort(nextNewMoonDate) : 'N/A'}</text>
            <text x="18" y="38" font-family="sans-serif" font-size="11" font-weight="bold" fill="black" opacity="0.6">Next New Moon</text>
          </g>
        </g>
      </g>
    `;
  }
};
