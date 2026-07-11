// east_suffolk_bins.js - East Suffolk Council Bin Collection Dates Finder Plugin
const https = require('https');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

// Helper to perform HTTPS request returning a Promise
function makeRequest(url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      method,
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': USER_AGENT,
        ...headers
      },
      timeout: 10000,
      rejectUnauthorized: false // Bypass local proxy or leaf certificate issues
    };
    
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function parseCookies(responseHeaders) {
  const cookies = [];
  if (responseHeaders['set-cookie']) {
    responseHeaders['set-cookie'].forEach(cookieStr => {
      const parts = cookieStr.split(';')[0].split('=');
      cookies.push({ name: parts[0].trim(), value: parts[1].trim() });
    });
  }
  return cookies;
}

// Map collection descriptions to clean types and colors
const parseBinType = (rawType) => {
  // Strip emojis
  let clean = rawType.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2190}-\u{21FF}]/gu, '').trim();
  
  let parts = clean.split(' - ');
  let name = parts[0].trim();
  let container = parts[1] ? parts[1].trim() : '';
  
  name = name.replace(/\s+/g, ' ');
  
  let color = 'grey';
  let shortName = name;
  
  const lowerName = name.toLowerCase();
  if (lowerName.includes('general waste') || lowerName.includes('refuse') || lowerName.includes('rubbish')) {
    color = 'grey';
    shortName = 'General Waste';
  } else if (lowerName.includes('container recycling') || (lowerName.includes('recycling') && !lowerName.includes('paper'))) {
    color = 'blue';
    shortName = 'Recycling';
  } else if (lowerName.includes('paper and cardboard') || lowerName.includes('paper') || lowerName.includes('cardboard')) {
    color = 'green';
    shortName = 'Paper & Card';
  } else if (lowerName.includes('food waste') || lowerName.includes('food')) {
    color = 'food';
    shortName = 'Food Waste';
  } else if (lowerName.includes('garden waste') || lowerName.includes('garden')) {
    color = 'garden';
    shortName = 'Garden Waste';
  }
  
  return {
    fullName: name,
    shortName,
    container: container ? container.replace(/ - standard bin| - outdoor caddy/gi, '').trim() : 'Standard Bin',
    color
  };
};

// Generate realistic future collection dates for mock display
const getMockCollections = () => {
  const collections = [];
  const today = new Date();
  
  // Food waste is weekly
  for (let i = 1; i <= 4; i++) {
    const d = new Date(today);
    // Let's assume collection is every Tuesday
    const dayOffset = (2 - today.getDay() + 7) % 7 || 7;
    d.setDate(today.getDate() + dayOffset + (i - 1) * 7);
    collections.push({
      date: d.toISOString().split('T')[0],
      fullName: 'Food waste',
      shortName: 'Food Waste',
      container: 'Outdoor Caddy',
      color: 'food'
    });
  }
  
  // General waste is every 3 weeks (refuse)
  const dRefuse = new Date(today);
  const refuseOffset = (5 - today.getDay() + 7) % 7 || 7; // Friday
  dRefuse.setDate(today.getDate() + refuseOffset);
  collections.push({
    date: dRefuse.toISOString().split('T')[0],
    fullName: 'General waste',
    shortName: 'General Waste',
    container: 'Standard Bin',
    color: 'grey'
  });
  
  const dRefuse2 = new Date(dRefuse);
  dRefuse2.setDate(dRefuse.getDate() + 21);
  collections.push({
    date: dRefuse2.toISOString().split('T')[0],
    fullName: 'General waste',
    shortName: 'General Waste',
    container: 'Standard Bin',
    color: 'grey'
  });

  // Recycling (Blue Lid) is every 3 weeks
  const dRecycle = new Date(dRefuse);
  dRecycle.setDate(dRefuse.getDate() + 7);
  collections.push({
    date: dRecycle.toISOString().split('T')[0],
    fullName: 'Container recycling',
    shortName: 'Recycling',
    container: 'Standard Bin',
    color: 'blue'
  });

  // Paper/Cardboard (Green Lid) is every 3 weeks
  const dPaper = new Date(dRefuse);
  dPaper.setDate(dRefuse.getDate() + 14);
  collections.push({
    date: dPaper.toISOString().split('T')[0],
    fullName: 'Paper and cardboard',
    shortName: 'Paper & Card',
    container: 'Standard Bin',
    color: 'green'
  });

  // Sort by date
  return collections.sort((a, b) => new Date(a.date) - new Date(b.date));
};

// Render bin vectors in 4-level grayscale
const drawBinIcon = (binColor, cx, cy, scale = 1.0) => {
  let lidFill = '#000000';
  let bodyFill = '#ffffff';
  let isCaddy = false;
  
  if (binColor === 'grey') {
    lidFill = '#333333'; // Dark gray/black lid
    bodyFill = '#cccccc'; // Medium-light body
  } else if (binColor === 'blue') {
    lidFill = '#666666'; // Dark-medium lid (blue in gray)
    bodyFill = '#f2f2f2'; // Very light body
  } else if (binColor === 'green') {
    lidFill = '#b3b3b3'; // Light gray lid (green in gray)
    bodyFill = '#ffffff'; // White body
  } else if (binColor === 'garden') {
    lidFill = '#808080'; // Medium gray lid
    bodyFill = '#ffffff';
  } else if (binColor === 'food') {
    isCaddy = true;
  }
  
  if (isCaddy) {
    return `
      <g transform="translate(${cx}, ${cy}) scale(${scale})">
        <!-- Caddy Body -->
        <rect x="-11" y="-8" width="22" height="19" rx="2" fill="#666666" stroke="black" stroke-width="1.8" />
        <!-- Caddy Lid -->
        <rect x="-13" y="-12" width="26" height="4" rx="1.5" fill="#333333" stroke="black" stroke-width="1.5" />
        <!-- Handle -->
        <path d="M-10 1 L-10 -15 L10 -15 L10 1" fill="none" stroke="black" stroke-width="1.2" stroke-linecap="round" />
        <!-- Food Symbol (Apple Core) -->
        <path d="M-3 -4 L3 -4 A3 3 0 0 1 1 0 A3 3 0 0 1 3 4 L-3 4 A3 3 0 0 1 -1 0 A3 3 0 0 1 -3 -4 Z" fill="white" />
        <line x1="0" y1="-6" x2="0" y2="-4" stroke="white" stroke-width="1" />
      </g>
    `;
  } else {
    return `
      <g transform="translate(${cx}, ${cy}) scale(${scale})">
        <!-- Wheels -->
        <circle cx="-10" cy="18" r="4" fill="black" />
        <circle cx="10" cy="18" r="4" fill="black" />
        <circle cx="-10" cy="18" r="1.5" fill="white" />
        <circle cx="10" cy="18" r="1.5" fill="white" />
        
        <!-- Bin Body -->
        <polygon points="-13,-16 13,-16 9.5,16 -9.5,16" fill="${bodyFill}" stroke="black" stroke-width="2" />
        
        <!-- Body texture lines -->
        <line x1="-5" y1="-10" x2="-3.5" y2="10" stroke="black" stroke-width="1.2" opacity="0.2" />
        <line x1="0" y1="-10" x2="0" y2="10" stroke="black" stroke-width="1.2" opacity="0.2" />
        <line x1="5" y1="-10" x2="3.5" y2="10" stroke="black" stroke-width="1.2" opacity="0.2" />
        
        <!-- Bin Lid -->
        <path d="M-15,-16 L15,-16 L11.5,-21 L-11.5,-21 Z" fill="${lidFill}" stroke="black" stroke-width="2" stroke-linejoin="round" />
        <rect x="-4" y="-24" width="8" height="3" fill="black" rx="1" />
        
        <!-- Handle -->
        <path d="M-13,-12 L-17,-12 L-17,-3" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    `;
  }
};

module.exports = {
  id: "east_suffolk_bins",
  name: "East Suffolk Bins",
  description: "Shows the next four weeks of scheduled bin collections based on UPRN.",
  configFields: [
    { 
      key: "uprn", 
      label: "Property UPRN", 
      type: "text", 
      default: "", 
      helpUrl: "https://www.findmyaddress.co.uk/", 
      helpLabel: "🔍 Find UPRN" 
    }
  ],

  async fetchData(settings) {
    const uprn = (settings.uprn || "").trim();
    
    if (!uprn) {
      console.log("[East Suffolk Bins] No UPRN configured, returning mock schedule.");
      return {
        uprn: "MOCK_MODE",
        isMock: true,
        collections: getMockCollections()
      };
    }
    
    try {
      // 1. Visit finder page to get session cookies
      const mainRes = await makeRequest('https://my.eastsuffolk.gov.uk/service/Bin_collection_dates_finder');
      let cookies = parseCookies(mainRes.headers);
      
      // 2. Visit iframe page to initialize session
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const iframeRes = await makeRequest('https://my.eastsuffolk.gov.uk/fillform/?iframe_id=fillform-frame-1&db_id=', 'GET', null, {
        'Cookie': cookieHeader,
        'Referer': 'https://my.eastsuffolk.gov.uk/service/Bin_collection_dates_finder'
      });
      cookies = cookies.concat(parseCookies(iframeRes.headers));
      const fullCookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const phpsessidCookie = cookies.find(c => c.name === 'PHPSESSID');
      const sid = phpsessidCookie ? phpsessidCookie.value : '';
      
      if (!sid) {
        throw new Error("Failed to extract PHPSESSID cookie");
      }
      
      // 3. Authenticate integration
      const ts = Date.now();
      const authUrl = `https://my.eastsuffolk.gov.uk/apibroker/runLookup?id=59e73f8bd860c&repeat_against=&noRetry=false&getOnlyTokens=undefined&log_id=&app_name=AF-Renderer::Self&_=${ts}&sid=${sid}&noRetry=true`;
      
      const apiHeaders = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://my.eastsuffolk.gov.uk/fillform/?iframe_id=fillform-frame-1&db_id=',
        'Cookie': fullCookieHeader
      };
      
      const authRes = await makeRequest(authUrl, 'POST', '{}', apiHeaders);
      if (authRes.statusCode !== 200) {
        throw new Error(`Authentication lookup failed with status: ${authRes.statusCode}`);
      }
      
      const authPayload = JSON.parse(authRes.body);
      const rowsData = authPayload.integration && authPayload.integration.transformed && authPayload.integration.transformed.rows_data;
      if (!rowsData || !rowsData['0'] || !rowsData['0'].AuthenticateResponse) {
        throw new Error("Bartec authentication token not returned");
      }
      const authToken = rowsData['0'].AuthenticateResponse;
      
      // 4. Query scheduled collections
      const today = new Date();
      const end = new Date(today.getTime() + 28 * 24 * 60 * 60 * 1000); // 28 days (4 weeks)
      
      const formatDate = (date) => {
        return date.toISOString().split('T')[0] + 'T00:00:00';
      };
      
      const requestBody = JSON.stringify({
        formValues: {
          Details: {
            AuthenticateResponse: { value: authToken },
            finalUPRN: { value: uprn },
            minimum_date: { value: formatDate(today) },
            maximum_date: { value: formatDate(end) }
          }
        }
      });
      
      const binsUrl = `https://my.eastsuffolk.gov.uk/apibroker/runLookup?id=68f900a32e7a4&repeat_against=&noRetry=false&getOnlyTokens=undefined&log_id=&app_name=AF-Renderer::Self&_=${Date.now()}&sid=${sid}`;
      
      const binsRes = await makeRequest(binsUrl, 'POST', requestBody, apiHeaders);
      if (binsRes.statusCode !== 200) {
        throw new Error(`Schedule query failed with status: ${binsRes.statusCode}`);
      }
      
      const binsPayload = JSON.parse(binsRes.body);
      const binRows = binsPayload.integration && binsPayload.integration.transformed && binsPayload.integration.transformed.rows_data;
      
      if (!binRows || Object.keys(binRows).length === 0) {
        console.log(`[East Suffolk Bins] No collections found for UPRN ${uprn}, using mock data.`);
        return {
          uprn,
          isMock: false,
          warning: "No active collections found in council calendar.",
          collections: getMockCollections()
        };
      }
      
      // Deduplicate and parse rows
      const seen = new Set();
      const collections = [];
      
      Object.keys(binRows).forEach(key => {
        const row = binRows[key];
        const rawDate = row.CollectionDate ? row.CollectionDate.split('T')[0] : '';
        const rawType = row.CollectionTypeDescriptive || '';
        
        if (rawDate && rawType) {
          const parsed = parseBinType(rawType);
          const uniqKey = `${rawDate}_${parsed.shortName}`;
          if (!seen.has(uniqKey)) {
            seen.add(uniqKey);
            collections.push({
              date: rawDate,
              fullName: parsed.fullName,
              shortName: parsed.shortName,
              container: parsed.container,
              color: parsed.color
            });
          }
        }
      });
      
      // Sort collections by date
      collections.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      return {
        uprn,
        isMock: false,
        collections: collections.slice(0, 8) // Limit to next 8 collections
      };
      
    } catch (e) {
      console.error("[East Suffolk Bins] Error fetching live schedule, using fallback mock data:", e.message);
      return {
        uprn,
        isMock: true,
        error: e.message,
        collections: getMockCollections()
      };
    }
  },

  renderSVG(data, width, height) {
    const padding = 20;
    const isFullScreen = height > 300;
    const collections = data.collections || [];
    
    // Date formatting helpers
    const getDaysRemainingText = (dateStr) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const colDate = new Date(dateStr);
      colDate.setHours(0, 0, 0, 0);
      
      const diffTime = colDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) return "TODAY";
      if (diffDays === 1) return "TOMORROW";
      if (diffDays < 7) return `In ${diffDays} days`;
      const weeks = Math.floor(diffDays / 7);
      const remDays = diffDays % 7;
      if (remDays === 0) {
        return `In ${weeks} week${weeks > 1 ? 's' : ''}`;
      } else {
        return `In ${weeks}w ${remDays}d`;
      }
    };
    
    const formatDateLabel = (dateStr) => {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const d = new Date(dateStr);
      return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    };

    if (isFullScreen) {
      // 1. Elegant Card-based Full-Screen Dashboard Layout
      const maxCards = 4;
      const activeCollections = collections.slice(0, maxCards);
      
      let cardsHtml = '';
      const cardWidth = 175;
      const cardHeight = 340;
      const cardGap = (width - padding * 2 - cardWidth * maxCards) / (maxCards - 1);
      const startY = 85;

      activeCollections.forEach((col, idx) => {
        const startX = padding + idx * (cardWidth + cardGap);
        const daysText = getDaysRemainingText(col.date);
        const dateText = formatDateLabel(col.date);
        
        let headerBg = 'black';
        let headerText = 'white';
        let isUrgent = daysText === 'TODAY' || daysText === 'TOMORROW';
        
        if (isUrgent) {
          headerBg = 'black';
          headerText = 'white';
        } else {
          headerBg = 'none';
          headerText = 'black';
        }
        
        cardsHtml += `
          <!-- Card ${idx + 1} -->
          <g transform="translate(${startX}, ${startY})">
            <!-- Card Frame -->
            <rect x="0" y="0" width="${cardWidth}" height="${cardHeight}" rx="8" fill="none" stroke="black" stroke-width="1.5" />
            
            <!-- Card Header -->
            ${headerBg !== 'none' ? `
              <path d="M 0 8 A 8 8 0 0 1 8 0 L ${cardWidth - 8} 0 A 8 8 0 0 1 ${cardWidth} 8 L ${cardWidth} 36 L 0 36 Z" fill="${headerBg}" />
            ` : `
              <line x1="0" y1="36" x2="${cardWidth}" y2="36" stroke="black" stroke-width="1" opacity="0.3" />
            `}
            
            <!-- Header Text -->
            <text x="${cardWidth / 2}" y="23" font-family="sans-serif" font-size="12" font-weight="bold" fill="${headerText}" text-anchor="middle" letter-spacing="0.5">${daysText}</text>
            
            <!-- Bin Vector Icon -->
            ${drawBinIcon(col.color, cardWidth / 2, 130, 1.8)}
            
            <!-- Bin Type Details -->
            <text x="${cardWidth / 2}" y="240" font-family="sans-serif" font-size="15" font-weight="bold" fill="black" text-anchor="middle">${escapeXml(col.shortName)}</text>
            <text x="${cardWidth / 2}" y="260" font-family="sans-serif" font-size="11.5" fill="black" opacity="0.6" text-anchor="middle">${escapeXml(col.container)}</text>
            
            <!-- Date Capsule Badge -->
            <rect x="15" y="295" width="${cardWidth - 30}" height="30" rx="15" fill="none" stroke="black" stroke-width="1" stroke-dasharray="${isUrgent ? 'none' : '3,3'}" />
            <text x="${cardWidth / 2}" y="314" font-family="sans-serif" font-size="12" font-weight="bold" fill="black" text-anchor="middle">${dateText}</text>
          </g>
        `;
      });
      
      // If less than 4 cards, show placeholder
      if (activeCollections.length === 0) {
        cardsHtml = `
          <rect x="${padding}" y="${startY}" width="${width - padding * 2}" height="${cardHeight}" rx="8" fill="none" stroke="black" stroke-width="1" stroke-dasharray="4,4" opacity="0.4" />
          <text x="${width / 2}" y="${startY + cardHeight / 2}" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle" fill="black" opacity="0.5">No upcoming bin collections scheduled.</text>
        `;
      }

      // Title Subtitle Label
      let subtitle = `SCHEDULED SERVICE CALENDAR (UPRN: ${data.uprn})`;
      if (data.isMock) {
        subtitle = "DEMONSTRATION CALENDAR (FALLBACK MOCK DATA)";
      }
      if (data.warning) {
        subtitle += ` — ⚠️ ${data.warning}`;
      }

      return `
        <g>
          <!-- Title Banner -->
          <rect x="0" y="0" width="${width}" height="52" fill="black" />
          <g transform="translate(${padding}, 17)" fill="white">
            <!-- Trash Can Icon -->
            <path d="M6,19c0,1.1,0.9,2,2,2h8c1.1,0,2-0.9,2-2V7H6V19z M8,9h8v10H8V9z M15.5,4l-1-1h-5l-1,1H5v2h14V4H15.5z" transform="scale(0.85)" />
          </g>
          <text x="${padding + 22}" y="35" font-family="sans-serif" font-size="20" font-weight="bold" fill="white" letter-spacing="1">EAST SUFFOLK BIN SCHEDULE</text>
          
          <!-- Sub-Header Info -->
          <text x="${padding}" y="74" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" opacity="0.45" letter-spacing="0.5">${escapeXml(subtitle.toUpperCase())}</text>
          
          <!-- Rendered Cards -->
          ${cardsHtml}
        </g>
      `;
    } else {
      // 2. Compact Grid Cell Layout (e.g. 400x240)
      const compactPadding = 15;
      const maxRows = 3;
      const activeCollections = collections.slice(0, maxRows);
      
      let listHtml = '';
      const rowHeight = 44;
      const startY = 48;
      
      activeCollections.forEach((col, idx) => {
        const yPos = startY + idx * rowHeight;
        const daysText = getDaysRemainingText(col.date);
        const dateText = formatDateLabel(col.date);
        
        let labelStyle = 'font-weight="bold"';
        if (daysText === 'TODAY' || daysText === 'TOMORROW') {
          labelStyle = 'font-weight="bold" fill="black"';
        }
        
        listHtml += `
          <!-- Row ${idx + 1} -->
          <g transform="translate(0, ${yPos})">
            <!-- Small Bin Icon -->
            ${drawBinIcon(col.color, compactPadding + 10, 16, 0.9)}
            
            <!-- Collection Info -->
            <text x="${compactPadding + 32}" y="15" font-family="sans-serif" font-size="12" font-weight="bold" fill="black">${escapeXml(col.shortName)}</text>
            <text x="${compactPadding + 32}" y="27" font-family="sans-serif" font-size="10.5" fill="black" opacity="0.5">${escapeXml(col.container)}</text>
            
            <!-- Date & Days remaining -->
            <text x="${width - compactPadding}" y="15" font-family="sans-serif" font-size="11.5" ${labelStyle} text-anchor="end">${daysText}</text>
            <text x="${width - compactPadding}" y="27" font-family="sans-serif" font-size="10" fill="black" opacity="0.5" text-anchor="end">${dateText}</text>
            
            <!-- Separator Line -->
            ${idx < activeCollections.length - 1 ? `
              <line x1="${compactPadding}" y1="36" x2="${width - compactPadding}" y2="36" stroke="black" stroke-width="0.5" opacity="0.15" />
            ` : ''}
          </g>
        `;
      });
      
      if (activeCollections.length === 0) {
        listHtml = `
          <text x="${width / 2}" y="${height / 2 + 10}" font-family="sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="black" opacity="0.5">No upcoming bin collections.</text>
        `;
      }

      return `
        <g>
          <!-- Compact Header -->
          <rect x="0" y="0" width="${width}" height="32" fill="black" />
          <g transform="translate(${compactPadding}, 9)" fill="white">
            <path d="M6,19c0,1.1,0.9,2,2,2h8c1.1,0,2-0.9,2-2V7H6V19z M15.5,4l-1-1h-5l-1,1H5v2h14V4H15.5z" transform="scale(0.55)" />
          </g>
          <text x="${compactPadding + 16}" y="21" font-family="sans-serif" font-size="13" font-weight="bold" fill="white">BIN COLLECTIONS</text>
          
          <!-- Compact List -->
          ${listHtml}
        </g>
      `;
    }
  }
};
