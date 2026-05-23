module.exports = {
  id: "feynman_quote",
  name: "Richard Feynman Quote",
  description: "Displays a daily quote from the legendary physicist Richard Feynman.",
  configFields: [],

  /**
   * Helper function to wrap text for SVG display.
   * Estimates character width based on font size and wraps words to fit maxCharsPerLine.
   * @param {string} text - The text to wrap.
   * @param {number} maxCharsPerLine - Maximum number of characters per line.
   * @returns {string[]} An array of wrapped lines.
   */
  _wordWrap: function(text, maxCharsPerLine) {
    if (!text) return [""];
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      // Check if adding the next word would exceed the character limit for the current line
      // And ensure we don't start a new line if the current one is empty (to prevent leading spaces)
      if ((currentLine + word).length > maxCharsPerLine && currentLine.length > 0) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine += word + ' ';
      }
    }
    lines.push(currentLine.trim()); // Add the last line
    return lines;
  },

  /**
   * Fetches a daily Richard Feynman quote from an internal list.
   * This function is offline-safe as it does not rely on external APIs.
   * @param {object} settings - User-defined settings for the widget (not used in this widget).
   * @param {object} device - Device information (e.g., screen dimensions, timezone).
   * @returns {Promise<object>} A promise that resolves to a flat JSON object containing the quote.
   */
  async fetchData(settings, device = {}) {
    const feynmanQuotes = [
      "The first principle is that you must not fool yourself and you are the easiest person to fool.",
      "What I cannot create, I do not understand.",
      "Science is the belief in the ignorance of experts.",
      "Physics is like sex: sure, it may give some practical results, but that's not why we do it.",
      "To understand the world, you must be curious, not merely learn facts.",
      "If you want to master something, teach it.",
      "Study hard what interests you the most in the most undisciplined, irreverent and original manner possible.",
      "The imagination of nature is far, far greater than the imagination of man.",
      "It doesn't matter how beautiful your theory is, it doesn't matter how smart you are. If it doesn't agree with experiment, it's wrong.",
      "The highest forms of understanding we can achieve are laughter and human compassion.",
      "I learned very early the difference between knowing the name of something and knowing something.",
      "There is a great difference between knowing and understanding: you can know a lot about something and not really understand it.",
      "For a successful technology, reality must take precedence over public relations, for Nature cannot be fooled.",
      "The idea is to try to understand the world with a definite and distinct sense of humor.",
      "I don't know what's the matter with people: they don't learn by understanding; they learn by some other method—by rote or something. Their knowledge is so fragile!",
      "We are at the very beginning of time for the human race. It is not unreasonable that we encounter problems.",
      "The test of all knowledge is experiment.",
      "You're not responsible for the world, you're responsible for your part in it.",
      "You have no responsibility to live up to what other people think you ought to accomplish. I have no responsibility to be like they expect me to be. It's their mistake, not my failing.",
      "It is important to realize that in physics today, we have no knowledge of what energy is.",
      "A scientist is a man who is trying to understand what is happening in the universe.",
      "Nobody ever figures out what life is all about, and it doesn't matter. Explore the world. Nearly everything is really interesting if you go into it deeply enough.",
      "You cannot learn to be a scientist. You can only become one.",
      "There is no learning without having to pose a question. And a question is a demand for an answer.",
      "We are lucky to live in an age in which we are still making discoveries.",
      "It is impossible to explain honestly the beauties of the laws of nature to a man who has had no training in mathematics.",
      "I was an inventor. I didn't learn, I invented.",
      "Physics isn't a religion. If it were, we'd have a much easier time raising money.",
      "Why are things the way they are? Because that's the way they are.",
      "The good thing about science is that it's true whether or not you believe in it.",
      "Our imagination is stretched to the utmost, not in inventing things, but in trying to discover what nature is like.",
      "Fall in love with some activity, and do it!",
      "Always keep an open mind.",
      "It's a great adventure to discover something new.",
      "If you are going to be a scientist, you have to be passionate about it.",
      "Nature is not bound by human laws.",
      "The game of science is to find out what is going on.",
      "I find that when I'm working on a problem, I like to just mess around with it.",
      "Our civilization depends on science and understanding.",
      "Science is the poetry of reality.",
      "I was born not knowing and have only had a little time to change that here and there.",
      "If a child can't understand it, then you don't really understand it yourself.",
      "I believe in the importance of doubt.",
      "The more you look, the more you see.",
      "There is plenty of room at the bottom.",
      "I feel a responsibility to make science understandable to the public.",
      "The most important thing is to have fun doing science.",
      "You have to be a little bit crazy to do physics.",
      "The more we learn, the more we find out how much we don't know.",
      "I consider myself a student of the universe.",
      "We just make guesses, and test them.",
      "Mathematics is not just a language. It is a language plus reason. It is a tool for reasoning.",
      "I don't need to be a part of a group.",
      "I have approximate answers and possible beliefs and different degrees of certainty about different things, but I'm not absolutely sure of anything.",
      "I found that the more I pushed myself, the more I enjoyed it.",
      "The only way to learn is by doing.",
      "The purpose of physics is to find out how nature behaves.",
      "I approach everything in life with an attitude of 'what am I going to learn today?'",
      "It's not about being clever; it's about being patient.",
      "I have a computer. But I'm not a computer person.",
      "Don't take yourself so seriously.",
      "Think about what you're doing, and why you're doing it.",
      "There's no point in being an intellectual if you can't be an honest one.",
      "It's important to be willing to make mistakes.",
      "You must take the responsibility to discover the things that make you happy.",
      "The game of knowledge is to learn, and to grow.",
      "I don't have to be consistent. I can change my mind.",
      "I was constantly doing things for the fun of it.",
      "We are trying to understand the world, and we're just learning how to do it.",
      "The most important thing to remember is to keep your curiosity alive.",
      "I believe in the power of observation.",
      "It is true that the brain can do some things, that computers cannot.",
      "There is a difference between understanding and just knowing the words.",
      "I would imagine that if you don't know anything about something, you can find out about it.",
      "The joy of discovery is the greatest joy of all.",
      "The truth can be made known to all men.",
      "I don't believe in the idea of a 'finished' product.",
      "It's healthy to doubt."
    ];

    try {
      // Get current date to determine a daily quote
      const now = new Date();
      // Calculate day of the year (0-365)
      const start = new Date(now.getFullYear(), 0, 0);
      const diff = (now - start) + ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay);

      // Use modulo to cycle through quotes each day
      const quoteIndex = dayOfYear % feynmanQuotes.length;
      const quote = feynmanQuotes[quoteIndex];

      return {
        quote: quote,
        author: "Richard Feynman"
      };
    } catch (error) {
      console.error("Feynman Quote Widget: Error fetching data:", error);
      // Return a robust offline fallback
      return {
        quote: "The first principle is that you must not fool yourself and you are the easiest person to fool.",
        author: "Richard Feynman"
      };
    }
  },

  /**
   * Renders the SVG output for the Richard Feynman Quote widget.
   * @param {object} data - The data returned by fetchData.
   * @param {number} width - The width of the SVG container.
   * @param {number} height - The height of the SVG container.
   * @returns {string} A string containing valid SVG elements.
   */
  renderSVG(data, width, height) {
    const HEADER_FONT_SIZE_RATIO = 0.06; // 6% of height
    const QUOTE_FONT_SIZE_RATIO = 0.045; // 4.5% of height
    const AUTHOR_FONT_SIZE_RATIO = 0.03; // 3% of height
    const PADDING_RATIO = 0.04; // 4% of width/height for padding

    const headerFontSize = Math.max(16, height * HEADER_FONT_SIZE_RATIO);
    const quoteFontSize = Math.max(14, height * QUOTE_FONT_SIZE_RATIO);
    const authorFontSize = Math.max(12, height * AUTHOR_FONT_SIZE_RATIO);

    const paddingX = width * PADDING_RATIO;
    const paddingY = height * PADDING_RATIO;

    const usableWidth = width - (2 * paddingX);
    const usableHeight = height - (2 * paddingY);

    // Estimate average character width for text wrapping (for a sans-serif font)
    // This is an approximation and might need adjustment based on the actual font rendered by the device.
    const avgCharWidth = quoteFontSize * 0.55; // Roughly 55% of font height for character width
    const maxCharsPerLine = Math.floor(usableWidth / avgCharWidth);

    const quoteText = data.quote || 'Knowledge increases by diffusion and not by dilution.';
    const authorText = data.author ? `— ${data.author}` : '— Richard Feynman';

    const wrappedQuoteLines = this._wordWrap(quoteText, maxCharsPerLine);

    // Calculate vertical position for the header, ensuring it's not too close to the top edge.
    const headerY = paddingY + headerFontSize;

    // Calculate total height needed for the quote text
    const lineHeight = quoteFontSize * 1.3; // 1.3em line spacing
    const quoteBlockHeight = wrappedQuoteLines.length * lineHeight;

    // Calculate vertical position to center the quote block roughly in the middle,
    // after the header and before the author.
    let quoteStartY = headerY + (usableHeight - headerFontSize - authorFontSize - quoteBlockHeight) / 2;
    if (quoteStartY < headerY + headerFontSize * 1.5) { // Ensure space between header and quote
      quoteStartY = headerY + headerFontSize * 1.5;
    }


    let svg = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="white" />

      <text x="${width / 2}" y="${headerY}" font-family="monospace, sans-serif" font-size="${headerFontSize}" fill="black" text-anchor="middle" font-weight="bold">
        Richard Feynman Quote
      </text>
    `;

    // Render wrapped quote lines
    let currentY = quoteStartY;
    for (const [index, line] of wrappedQuoteLines.entries()) {
      svg += `
        <text x="${width / 2}" y="${currentY}" font-family="monospace, sans-serif" font-size="${quoteFontSize}" fill="black" text-anchor="middle">
          <tspan x="${width / 2}" dy="${index === 0 ? 0 : lineHeight}">${line}</tspan>
        </text>
      `;
      currentY += lineHeight;
    }

    // Render author at the bottom, dynamically positioned
    const authorY = Math.min(height - paddingY, currentY + authorFontSize * 1.5); // Ensure author is visible, not overlapping quote too much, and within bounds
    svg += `
      <text x="${width / 2}" y="${authorY}" font-family="monospace, sans-serif" font-size="${authorFontSize}" fill="black" text-anchor="middle" font-style="italic">
        ${authorText}
      </text>
    `;

    return svg;
  }
};