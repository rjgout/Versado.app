// Uitsluitend GitHub-hosted development-publicatie; geen NAS- of deployfunctionaliteit.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function developmentImages(env) {
  if (env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/develop" || env.GITHUB_REPOSITORY !== "rjgout/Versado.app") {
    throw new Error("Publicatie is uitsluitend toegestaan bij een push naar rjgout/Versado.app:develop.");
  }
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")) throw new Error("Volledige commit-SHA ontbreekt.");
  return ["app", "proxy"].map((kind) => {
    const image = `ghcr.io/rjgout/jehova-${kind}`;
    return { image, local: `versado-dev-${kind}:${env.GITHUB_SHA}`, commit: `${image}:dev-sha-${env.GITHUB_SHA}`, alias: `${image}:dev` };
  });
}

export function publishDevelopment({ env = process.env, run = spawnSync, log = console.log } = {}) {
  const images = developmentImages(env); // Weigeren vóór ieder extern commando, ook buiten Actions.
  const command = (program, args, optional = false) => {
    const result = run(program, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw new Error(`${program} kon niet starten.`, { cause: result.error });
    if (!optional && result.status !== 0) throw new Error(`${program} mislukt (exit ${result.status}); publicatie gestopt.`);
    return result;
  };
  const digestOf = (ref) => {
    const result = command("docker", ["buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", ref], true);
    if (result.status !== 0) {
      const message = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
      if (/manifest unknown|no such manifest/i.test(message) || message.includes(`${ref}: not found`)) return null;
      throw new Error("Registrycontrole mislukt; niet als ontbrekende tag behandeld.");
    }
    let digest;
    try { digest = JSON.parse(result.stdout).digest; } catch { throw new Error("Registry gaf geen geldig manifestdescriptor."); }
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Registry gaf geen geldige image-digest.");
    return digest;
  };

  // Eerst alle tags inspecteren: autorisatie-/netwerkfouten zijn geen toestemming tot overschrijven.
  const existing = images.map(({ commit }) => digestOf(commit));
  const sources = images.map((image, index) => {
    let digest = existing[index];
    if (!digest) {
      command("docker", ["tag", image.local, image.commit]);
      command("docker", ["push", image.commit]);
      digest = digestOf(image.commit);
      if (!digest) throw new Error("Gepubliceerde commit-tag niet teruggevonden; dev blijft ongewijzigd.");
    }
    log(`${image.commit} -> ${digest}`);
    return `${image.image}@${digest}`;
  });

  // Actions-queuevolgorde is niet gegarandeerd. Een achterhaalde run mag dev niet terugzetten.
  const current = command("gh", ["api", "repos/rjgout/Versado.app/git/ref/heads/develop", "--jq", ".object.sha"]).stdout.trim();
  if (current !== env.GITHUB_SHA) {
    log("Develop is verder gegaan; alleen de commit-tags zijn bewaard, dev niet bijgewerkt.");
    return { updated: false, sources };
  }
  for (const [index, image] of images.entries()) {
    command("docker", ["buildx", "imagetools", "create", "--prefer-index=false", "--tag", image.alias, sources[index]]);
  }
  log("Beide dev-tags bijgewerkt; geen deployment uitgevoerd.");
  return { updated: true, sources };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { publishDevelopment(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
