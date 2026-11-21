// Metro also watches the repository's shared client modules (i18n catalogs,
// status and console projections) so iOS and the Mac client share one source.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, '../../client');
config.watchFolders = [...(config.watchFolders || []), shared];
if (!config.resolver.sourceExts.includes('mjs')) config.resolver.sourceExts.push('mjs');
// Shared modules have no node_modules of their own; resolve from this app.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
