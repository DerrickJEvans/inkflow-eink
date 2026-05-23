// rss_uk.js - BBC News UK RSS plugin wrapper
const rssCore = require('./rss');

module.exports = {
  id: "rss_uk",
  name: "BBC UK News",
  description: "Displays latest UK headlines from BBC News.",
  configFields: [],

  async fetchData(settings) {
    // Override the RSS URL specifically for BBC UK News
    return rssCore.fetchData({ url: "https://feeds.bbci.co.uk/news/uk/rss.xml", limit: settings.limit || 8 });
  },

  renderSVG(data, width, height) {
    // Re-use core renderSVG, overriding the title to be "BBC UK News"
    return rssCore.renderSVG({ ...data, title: "BBC UK News" }, width, height);
  }
};
