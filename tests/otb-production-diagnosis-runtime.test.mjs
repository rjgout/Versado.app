import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("de runtime-image kopieert uitsluitend de OTB read-only-diagnose uit content-architecture", () => {
  const dockerfile = readFileSync("Dockerfile", "utf8");
  assert.match(dockerfile, /COPY scripts\/content-architecture\/diagnose-otb-production-readonly\.mjs \.\/scripts\/content-architecture\/diagnose-otb-production-readonly\.mjs/);
  assert.doesNotMatch(dockerfile, /COPY scripts\/content-architecture\s+\.\/scripts\/content-architecture/);
});
