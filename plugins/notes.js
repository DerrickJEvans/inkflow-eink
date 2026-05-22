// notes.js - Custom text/todo checklist plugin
module.exports = {
  id: "notes",
  name: "Notice Board & Todo",
  description: "Displays checklists and bulleted text notices configured in your dashboard.",
  configFields: [
    { key: "title", label: "Board Title", type: "text", default: "Family Notice Board" },
    { key: "items", label: "Items (One per line or JSON Array)", type: "textarea", default: "" }
  ],

  async fetchData(settings) {
    let title = settings.title || "Family Notice Board";
    let rawItems = settings.items;
    let items = [];

    if (Array.isArray(rawItems)) {
      items = rawItems;
    } else if (typeof rawItems === 'string' && rawItems.trim()) {
      // Parse multi-line or JSON array
      if (rawItems.startsWith('[') && rawItems.endsWith(']')) {
        try {
          items = JSON.parse(rawItems);
        } catch (e) {
          items = rawItems.split('\n').map(x => x.trim()).filter(Boolean);
        }
      } else {
        items = rawItems.split('\n').map(x => x.trim()).filter(Boolean);
      }
    }

    // Default checklist items if empty
    if (items.length === 0) {
      items = [
        "Water the house plants 🌱",
        "Coffee beans are in the cupboard ☕",
        "Run the Pi Zero E-Ink client script",
        "ESP32 Deep Sleep enabled!"
      ];
    }

    return {
      title,
      items
    };
  },

  renderSVG(data, width, height) {
    const padding = 15;
    
    // Truncate function
    const truncateText = (text, maxLength) => {
      if (text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + "...";
    };

    const maxChars = Math.floor((width - padding * 2 - 25) / 7.2);
    let listHtml = '';
    const itemHeight = 33; // row height

    data.items.slice(0, 4).forEach((item, idx) => {
      const yPos = 65 + idx * itemHeight;
      let text = item;
      let isChecked = false;
      let isTodo = false;

      // Detect "[x] text" or "[ ] text"
      if (text.startsWith('[x]') || text.startsWith('[X]')) {
        isChecked = true;
        isTodo = true;
        text = text.substring(3).trim();
      } else if (text.startsWith('[ ]')) {
        isChecked = false;
        isTodo = true;
        text = text.substring(3).trim();
      }

      const cleanText = truncateText(text, maxChars);

      if (isTodo) {
        // Draw checkbox
        listHtml += `
          <!-- Checkbox item -->
          <rect x="${padding}" y="${yPos - 12}" width="12" height="12" rx="2" fill="none" stroke="black" stroke-width="1.5" />
          ${isChecked ? `
            <path d="M${padding + 2.5} ${yPos - 6} L${padding + 5} ${yPos - 3} L${padding + 9.5} ${yPos - 9}" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <text x="${padding + 20}" y="${yPos}" font-family="sans-serif" font-size="11.5" fill="black" text-decoration="line-through" opacity="0.6">${cleanText}</text>
          ` : `
            <text x="${padding + 20}" y="${yPos}" font-family="sans-serif" font-size="11.5" fill="black">${cleanText}</text>
          `}
        `;
      } else {
        // Draw bullet point
        listHtml += `
          <!-- Bullet item -->
          <circle cx="${padding + 6}" cy="${yPos - 6}" r="3" fill="black" />
          <text x="${padding + 20}" y="${yPos}" font-family="sans-serif" font-size="11.5" fill="black">${cleanText}</text>
        `;
      }
    });

    return `
      <g>
        <!-- Header -->
        <text x="${padding}" y="25" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">📌 ${data.title.toUpperCase()}</text>
        <line x1="${padding}" y1="32" x2="${width - padding}" y2="32" stroke="black" stroke-width="1.5" />
        
        <!-- List -->
        ${listHtml}
      </g>
    `;
  }
};
