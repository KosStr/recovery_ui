module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      // Must stay last. On Reanimated 4 this is provided by react-native-worklets.
      'react-native-worklets/plugin',
    ],
  };
};
