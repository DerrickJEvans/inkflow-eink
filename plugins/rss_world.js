// rss_world.js - BBC News World RSS plugin wrapper
const rssCore = require('./rss');

module.exports = {
  id: "rss_world",
  name: "BBC World News",
  description: "Displays latest global headlines from BBC News.",
  configFields: [],

  async fetchData(settings) {
    // Override the RSS URL specifically for BBC Global / World News
    return rssCore.fetchData({ url: "https://feeds.bbci.co.uk/news/world/rss.xml", limit: settings.limit || 8 });
  },

  renderSVG(data, width, height) {
    // Re-use core renderSVG, overriding the title to be "BBC World News"
    return rssCore.renderSVG({ ...data, title: "BBC World News" }, width, height);
  }
};
