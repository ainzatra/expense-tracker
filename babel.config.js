module.exports = function (api) {
  api.cache(true);
  return {
    plugins: [
      './scripts/metro-langchain-provider.cjs',
      './scripts/metro-langchain-runtime.cjs',
    ],
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
