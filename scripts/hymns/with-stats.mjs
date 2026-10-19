// Draait een commando en meldt wandkloktijd, CPU-tijd en piekgeheugen (RSS) van het hele procesboompje.
// Aanroep: node scripts/hymns/with-stats.mjs -- npx tsx scripts/hymns/eval-library.ts ...
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const cmd = process.argv.slice(process.argv.indexOf("--") + 1);
const start = Date.now();
const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit" });
let peakKb = 0;
function rssTree(root) {
  let total = 0;
  const kids = new Map();
  for (const p of readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
    try {
      const status = readFileSync(`/proc/${p}/status`, "utf8");
      const ppid = Number(/PPid:\s+(\d+)/.exec(status)?.[1]);
      const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
      kids.set(Number(p), { ppid, rss });
    } catch {}
  }
  const walk = (pid) => { const k = kids.get(pid); if (k) total += k.rss; for (const [p, v] of kids) if (v.ppid === pid) walk(p); };
  walk(root);
  return total;
}
const timer = setInterval(() => { peakKb = Math.max(peakKb, rssTree(child.pid)); }, 500);
child.on("exit", (code) => {
  clearInterval(timer);
  const u = process.resourceUsage();
  console.log(JSON.stringify({ wallSeconds: (Date.now() - start) / 1000, peakRssMb: Math.round(peakKb / 1024), childExit: code }));
  process.exit(code ?? 1);
});
