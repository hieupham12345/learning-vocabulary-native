const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('db'); // bundled seed database
config.resolver.assetExts.push('wasm'); // expo-sqlite web needs wa-sqlite.wasm

module.exports = config;