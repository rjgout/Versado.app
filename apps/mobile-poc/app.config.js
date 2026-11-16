// Uitsluitend voor de runtime-testbuilds (POC_TEST_BUILD=1): cleartext/ATS-uitzondering voor de lokale, geïsoleerde
// testbackend. NSAllowsLocalNetworking dekt localhost/127.0.0.1 (ATS kent geen uitzonderingsdomein voor IP-adressen). Een gewone build krijgt deze uitzonderingen niet.
module.exports = ({ config }) => {
  if (process.env.POC_TEST_BUILD !== "1") return config;
  return {
    ...config,
    ios: { ...config.ios, infoPlist: { ...config.ios?.infoPlist, NSAppTransportSecurity: { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true, NSExceptionDomains: { "127.0.0.1": { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } } } } },
    plugins: [...(config.plugins ?? []), ["expo-build-properties", { android: { usesCleartextTraffic: true } }]],
  };
};
