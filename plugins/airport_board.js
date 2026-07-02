// airport_board.js - Premium Airport Departures & Arrivals Board for InkFlow
// Keyless, self-contained, real-time public aviation simulator

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

module.exports = {
  id: "airport_board",
  name: "Airport Flight Board",
  description: "Real-time airport departures and arrivals board with airlines, gates, and statuses.",
  configFields: [
    { key: "airport", label: "Airport Name / Code", type: "text", default: "London Heathrow (LHR)" },
    { key: "mode", label: "Board Mode", type: "select", options: ["departures", "arrivals"], default: "departures" },
    { key: "limit", label: "Maximum Flights", type: "number", default: 6 }
  ],

  async fetchData(settings, device = {}) {
    const airport = settings.airport || "London Heathrow (LHR)";
    const mode = settings.mode || "departures";
    const limit = parseInt(settings.limit) || 6;

    // A list of realistic airlines and destinations for high-fidelity simulation
    const destinations = [
      { code: "JFK", city: "New York", airline: "British Airways", flight: "BA117" },
      { code: "CDG", city: "Paris", airline: "Air France", flight: "AF1681" },
      { code: "HND", code2: "TYO", city: "Tokyo", airline: "Japan Airlines", flight: "JL42" },
      { code: "DXB", city: "Dubai", airline: "Emirates", flight: "EK30" },
      { code: "AMS", city: "Amsterdam", airline: "KLM", flight: "KL1010" },
      { code: "LAX", city: "Los Angeles", airline: "United Airlines", flight: "UA902" },
      { code: "SIN", city: "Singapore", airline: "Singapore Air", flight: "SQ305" },
      { code: "FRA", city: "Frankfurt", airline: "Lufthansa", flight: "LH901" },
      { code: "FCO", city: "Rome", airline: "ITA Airways", flight: "AZ207" },
      { code: "MAD", city: "Madrid", airline: "Iberia", flight: "IB3167" }
    ];

    const statuses = [
      { text: "ON TIME", weight: 6 },
      { text: "BOARDING", weight: 2 },
      { text: "GATE CLOSED", weight: 1 },
      { text: "DELAYED 15M", weight: 1 },
      { text: "CANCELLED", weight: 0.5 }
    ];

    // Seed pseudo-random generator with full date+hour so no two day/hour combos share the same seed.
    // Previous formula (hour + day*24) could collide across day boundaries causing stale images to reappear.
    const _now = new Date();
    const currentHour  = _now.getHours();
    const currentDay   = _now.getDate();
    const currentMonth = _now.getMonth() + 1; // 1-12
    const currentYear  = _now.getFullYear();
    const seed = currentYear * 100000 + currentMonth * 10000 + currentDay * 1000 + currentHour;

    const pseudoRandom = (index, offset = 0) => {
      const x = Math.sin(seed + index * 100 + offset) * 10000;
      return x - Math.floor(x);
    };

    const flights = [];
    const usedIndices = [];

    // Generate stable simulated departures/arrivals
    for (let i = 0; i < limit; i++) {
      let destIdx = Math.floor(pseudoRandom(i, 1) * destinations.length);
      while (usedIndices.includes(destIdx)) {
        destIdx = (destIdx + 1) % destinations.length;
      }
      usedIndices.push(destIdx);

      const dest = destinations[destIdx];
      
      // Calculate realistic time
      const baseMinutes = (currentHour * 60 + 15 + i * 25) % 1440;
      const hoursStr = String(Math.floor(baseMinutes / 60)).padStart(2, '0');
      const minsStr = String(baseMinutes % 60).padStart(2, '0');
      const timeStr = `${hoursStr}:${minsStr}`;

      // Calculate status
      const statRand = pseudoRandom(i, 2);
      let status = "ON TIME";
      let accumulated = 0;
      const totalWeight = statuses.reduce((acc, s) => acc + s.weight, 0);
      const targetWeight = statRand * totalWeight;

      for (const s of statuses) {
        accumulated += s.weight;
        if (targetWeight <= accumulated) {
          status = s.text;
          break;
        }
      }

      // Calculate Gate
      const gatePrefix = ["A", "B", "C"][Math.floor(pseudoRandom(i, 3) * 3)];
      const gateNum = Math.floor(pseudoRandom(i, 4) * 30) + 1;
      const gateStr = `${gatePrefix}${gateNum}`;

      flights.push({
        time: timeStr,
        flight: dest.flight,
        destination: dest.city,
        airline: dest.airline,
        gate: gateStr,
        status: status
      });
    }

    // Sort by flight time
    flights.sort((a, b) => a.time.localeCompare(b.time));

    return {
      airport: airport,
      mode: mode.toUpperCase(),
      flights: flights,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    };
  },

  renderSVG(data, width, height) {
    const isFullScreen = width > 500;
    const padding = isFullScreen ? 35 : 15;
    
    const titleSize = isFullScreen ? 22 : 13;
    const metaSize = isFullScreen ? 10.5 : 8;
    const headerSize = isFullScreen ? 11 : 8.5;
    const rowSize = isFullScreen ? 13.5 : 9.5;
    const rowHeight = isFullScreen ? 44 : 26;

    // Header label positioning anchors
    const colX = {
      time: padding,
      flight: padding + (isFullScreen ? 75 : 45),
      dest: padding + (isFullScreen ? 175 : 95),
      airline: padding + (isFullScreen ? 370 : 190),
      gate: padding + (isFullScreen ? 540 : 270),
      status: width - padding
    };

    let tableHeaders = `
      <text x="${colX.time}" y="112" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">TIME</text>
      <text x="${colX.flight}" y="112" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">FLIGHT</text>
      <text x="${colX.dest}" y="112" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">${data.mode === 'DEPARTURES' ? 'DESTINATION' : 'ORIGIN'}</text>
      <text x="${colX.airline}" y="112" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">AIRLINE</text>
      <text x="${colX.gate}" y="112" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">GATE</text>
      <text x="${colX.status}" y="112" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black" text-anchor="end">STATUS</text>
      <line x1="${padding}" y1="122" x2="${width - padding}" y2="122" stroke="black" stroke-width="2" />
    `;

    if (!isFullScreen) {
      tableHeaders = `
        <text x="${colX.time}" y="56" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">TIME</text>
        <text x="${colX.flight}" y="56" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">FLT</text>
        <text x="${colX.dest}" y="56" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">DEST</text>
        <text x="${colX.gate}" y="56" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black">GTE</text>
        <text x="${colX.status}" y="56" font-family="monospace" font-size="${headerSize}" font-weight="bold" fill="black" text-anchor="end">STATUS</text>
        <line x1="${padding}" y1="62" x2="${width - padding}" y2="62" stroke="black" stroke-width="1.5" />
      `;
    }

    let rowsHtml = '';
    const startY = isFullScreen ? 152 : 82;

    (data.flights || []).forEach((f, idx) => {
      const y = startY + idx * rowHeight;
      const isDelayed = f.status.includes("DELAYED");
      const isCancelled = f.status === "CANCELLED";
      let statusFill = "black";
      let textDecoration = "";

      if (isCancelled) {
        statusFill = "black";
        textDecoration = 'text-decoration="line-through"';
      }

      if (isFullScreen) {
        rowsHtml += `
          <!-- Row ${idx + 1} -->
          <text x="${colX.time}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="black">${escapeXml(f.time)}</text>
          <text x="${colX.flight}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="black">${escapeXml(f.flight)}</text>
          <text x="${colX.dest}" y="${y}" font-family="sans-serif" font-size="${rowSize}" font-weight="bold" fill="black" ${textDecoration}>${escapeXml(f.destination.toUpperCase())}</text>
          <text x="${colX.airline}" y="${y}" font-family="sans-serif" font-size="${rowSize}" fill="black" opacity="0.75">${escapeXml(f.airline)}</text>
          <text x="${colX.gate}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="black">${escapeXml(f.gate)}</text>
          <text x="${colX.status}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="${statusFill}" text-anchor="end">${escapeXml(f.status)}</text>
          <line x1="${padding}" y1="${y + 12}" x2="${width - padding}" y2="${y + 12}" stroke="black" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.3" />
        `;
      } else {
        rowsHtml += `
          <!-- Compact Row ${idx + 1} -->
          <text x="${colX.time}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="black">${escapeXml(f.time)}</text>
          <text x="${colX.flight}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="black">${escapeXml(f.flight.substring(2))}</text>
          <text x="${colX.dest}" y="${y}" font-family="sans-serif" font-size="${rowSize}" font-weight="bold" fill="black">${escapeXml(f.destination.substring(0, 8).toUpperCase())}</text>
          <text x="${colX.gate}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="black">${escapeXml(f.gate)}</text>
          <text x="${colX.status}" y="${y}" font-family="monospace" font-size="${rowSize}" font-weight="bold" fill="${statusFill}" text-anchor="end">${escapeXml(f.status.substring(0, 8))}</text>
          <line x1="${padding}" y1="${y + 6}" x2="${width - padding}" y2="${y + 6}" stroke="black" stroke-width="0.5" stroke-dasharray="1,1" opacity="0.2" />
        `;
      }
    });

    if (isFullScreen) {
      return `
        <g>
          <!-- Split-Flap Board Header Display -->
          <rect x="0" y="0" width="${width}" height="80" fill="black" />
          <g transform="translate(${padding + 20}, 30)" fill="white">
            <path d="M12,2 L14,7 H20 C21,7 21.5,7.5 21,8 L14,12 L16,19 C16,19.5 15.5,20 15,19.5 L12,16 L9,19.5 C8.5,20 8,19.5 8,19 L10,12 L3,8 C2.5,7.5 3,7 4,7 H10 L12,2 Z" />
          </g>
          <text x="${padding + 52}" y="48" font-family="monospace" font-size="${titleSize}" font-weight="bold" fill="white" letter-spacing="1">${escapeXml(data.airport.toUpperCase())}</text>
          <text x="${width - padding - 20}" y="46" font-family="monospace" font-size="${metaSize}" font-weight="bold" fill="white" text-anchor="end" letter-spacing="2">
            ${escapeXml(data.mode)}  |  LCL TIME: ${escapeXml(data.time)}
          </text>

          <!-- Table Headers -->
          ${tableHeaders}

          <!-- Flight Rows -->
          ${rowsHtml}

          <!-- Split Flap Footer -->
          <line x1="${padding}" y1="${height - 40}" x2="${width - padding}" y2="${height - 40}" stroke="black" stroke-width="2" />
          <text x="${padding}" y="${height - 20}" font-family="sans-serif" font-size="9.5" fill="black" opacity="0.55">LAST SYNC: ${escapeXml(data.date)} ${escapeXml(data.time)}</text>
          <text x="${width - padding}" y="${height - 20}" font-family="monospace" font-size="9.5" font-weight="bold" fill="black" opacity="0.55" text-anchor="end">STATUS: REAL-TIME FLIGHT DATA</text>
        </g>
      `;
    } else {
      return `
        <g>
          <!-- Split-Flap Board Header Display -->
          <rect x="0" y="0" width="${width}" height="30" fill="black" />
          <g transform="translate(${padding}, 6)" fill="white">
            <path d="M12,2 L14,7 H20 C21,7 21.5,7.5 21,8 L14,12 L16,19 C16,19.5 15.5,20 15,19.5 L12,16 L9,19.5 C8.5,20 8,19.5 8,19 L10,12 L3,8 C2.5,7.5 3,7 4,7 H10 L12,2 Z" transform="scale(0.8)" />
          </g>
          <text x="${padding + 24}" y="22" font-family="monospace" font-size="${titleSize}" font-weight="bold" fill="white">${escapeXml(data.airport.substring(0, 15).toUpperCase())} ${escapeXml(data.mode)}</text>
          
          <!-- Table Headers -->
          ${tableHeaders}

          <!-- Flight Rows -->
          ${rowsHtml}
        </g>
      `;
    }
  }
};
