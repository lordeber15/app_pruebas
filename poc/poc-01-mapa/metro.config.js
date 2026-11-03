const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("pmtiles", "geojson", "pbf");

module.exports = config;
