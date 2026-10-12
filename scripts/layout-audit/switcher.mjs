// De publieke kiezer is een Focus-route. Hergebruik de bestaande veilige runner.
process.argv.push("--content-only");
await import("./test-isolated.mjs");
