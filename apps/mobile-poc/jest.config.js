module.exports = {
  preset: "jest-expo",
  // De eerste render per bestand compileert op een trage CI-runner (naast een draaiende backend) langer dan de standaard 5 s.
  testTimeout: 30000,
  testMatch: ["<rootDir>/tests/**/*.test.tsx", "<rootDir>/tests/**/*.test.ts"],
  moduleNameMapper: { "^(zod|socket\\.io-client|react)$": "<rootDir>/node_modules/$1", "^@babel/runtime/(.*)$": "<rootDir>/node_modules/@babel/runtime/$1", "^@poc/(.*)$": "<rootDir>/src/$1", "^@/(.*)$": "<rootDir>/../../src/$1" },
  transformIgnorePatterns: ["node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))"],
  // De gedeelde contractmodules staan buiten deze map en gebruiken zod uit deze app.
  modulePaths: ["<rootDir>/node_modules"],
  roots: ["<rootDir>", "<rootDir>/../../src/lib/native"],
};
