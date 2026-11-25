import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwind from "tailwindcss";
import config from "../tailwind.config";

test("de echte bronboom genereert alle bestaande mobiele min-breakpoints", async () => {
  const result = await postcss([tailwind(config)]).process(readFileSync("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
  // Een rem-variant tussen px-varianten kan Tailwind 3 zijn unitcache vergiftigen:
  // de compilatie slaagt dan, maar alle volgende mobiele regels ontbreken.
  for (const [width, utility] of [[380, "min-[380px]:flex"], [390, "min-[390px]:gap-4"], [400, "min-[400px]:inline"], [416, "min-[416px]:grid-cols-2"]] as const) {
    let found = false;
    result.root.walkAtRules("media", media => {
      if (media.params !== `(min-width: ${width}px)`) return;
      media.walkRules(rule => { if (rule.selector.replaceAll("\\", "").includes(utility)) found = true; });
    });
    assert.ok(found, `${utility} ontbreekt in de gedeelde web/native CSS`);
  }
});
