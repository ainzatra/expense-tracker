const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');
// LangSmith's ESM barrel has a circular Client initialization in Metro.
// Use its published CommonJS entry points and browser filesystem adapters.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'langsmith' || moduleName.startsWith('langsmith/')) {
    return context.resolveRequest({ ...context, isESMImport: false, unstable_conditionNames: ['require'], unstable_conditionsByPlatform: {} }, moduleName, platform);
  }
  if (context.originModulePath.includes('/langsmith/') && /\/(fs|worker_threads)\.cjs$/.test(moduleName)) {
    return context.resolveRequest(context, moduleName.replace('.cjs', '.browser.cjs'), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = enhance ? enhance(middleware, server) : middleware;
  return (request, response, done) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    return next(request, response, done);
  };
};
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
