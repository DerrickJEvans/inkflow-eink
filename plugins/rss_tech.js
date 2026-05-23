// rss_tech.js - BBC News Technology RSS plugin wrapper
const rssCore = require('./rss');

module.exports = {
  id: "rss_tech",
  name: "BBC Tech News",
  description: "Displays latest technology headlines from BBC News.",
  configFields: [],

  async fetchData(settings) {
    // Override the RSS URL specifically for BBC Technology
    return rssCore.fetchData({ url: "https://feeds.bbci.co.uk/news/technology/rss.xml", limit: settings.limit || 8 });
  },

  renderSVG(data, width, height) {
    // Re-use core renderSVG, overriding the title to be "BBC TECHNOLOGY"
    return rssCore.renderSVG({ ...data, title: "BBC Technology" }, width, height);
  }
};
