const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
// Alleen de gedeelde contractmodules van de hoofdapp zijn zichtbaar; geen tweede kopie van React of zod.
config.watchFolders = [path.join(root, "src/lib")];
const single = ["react", "react-native", "zod", "socket.io-client", "expo-crypto"];
config.resolver.extraNodeModules = Object.fromEntries(single.map(n => [n, path.join(__dirname, "node_modules", n)]));
config.resolver.resolveRequest = (context, name, platform) => {
  if (name.startsWith("@/")) return context.resolveRequest(context, path.join(root, "src", name.slice(2)), platform);
  const top = name.split("/")[0];
  if (single.includes(top) && context.originModulePath.startsWith(root + path.sep) && !context.originModulePath.includes(`${path.sep}apps${path.sep}mobile-poc${path.sep}`)) {
    return context.resolveRequest({ ...context, originModulePath: path.join(__dirname, "package.json") }, name, platform);
  }
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
