const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname, {
  // Required by NativeWind v4: it compiles Tailwind into a real CSS file that
  // Metro then has to be willing to treat as a module.
  isCSSEnabled: true,
});

// --- SVG as components -----------------------------------------------------
// The `/expo` entry point wraps Expo's own Babel transformer rather than
// replacing it, which is the difference between SVG imports working and the
// entire bundle losing Expo's transforms.
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer/expo');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

// Skia ships prebuilt binaries and needs no transformer, but its web build
// resolves a .wasm payload that must stay classified as an asset.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
});
