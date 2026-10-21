// Broninventaris, geen bewijs van functionele native pariteit of autorisatie.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export function filesIn(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || entry.name === "generated") return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }).sort();
}
export function routeFor(file) {
  return "/" + file.replace(/^src\/app\//, "").replace(/\/(page|route)\.[jt]sx?$/, "").replace(/^(page|route)\.[jt]sx?$/, "")
    .split("/").filter(part => part && !/^\([^)]*\)$/.test(part) && !part.startsWith("@")).join("/");
}
export function inspectModule(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Set(), methods = new Set(), requests = new Set(), checks = new Set(), exports = new Set();
  const directives = [];
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }
  const client = directives.includes("use client");
  const exported = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const call = node.expression.getText(ast);
      if (call === "import" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.add(node.arguments[0].text);
      if (/^(getCurrentUser(Id)?|require\w*|assert\w*|can\w*|nativeUser|nativeApi|verify\w*|get\w*Access)$/.test(call)) checks.add(call);
      const input = node.arguments[0];
      if (input && /(?:fetch|fetchJson|jsonMutation|\.api|\.publicRequest)$/.test(call)) {
        if (ts.isStringLiteral(input) || ts.isNoSubstitutionTemplateLiteral(input)) requests.add(input.text);
        else if (ts.isTemplateExpression(input)) requests.add(input.getText(ast).slice(1, -1));
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && exported(node)) {
      exports.add(node.name.text);
      if (HTTP.has(node.name.text)) methods.add(node.name.text);
    }
    if (ts.isVariableStatement(node) && exported(node)) for (const declaration of node.declarationList.declarations) {
      const name = declaration.name.getText(ast); exports.add(name); if (HTTP.has(name)) methods.add(name);
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) { exports.add(element.name.text); if (HTTP.has(element.name.text)) methods.add(element.name.text); }
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { file, sha256: createHash("sha256").update(source).digest("hex"), boundary: client ? "client" : "context-dependent", imports: [...imports].sort(), methods: [...methods].sort(), requests: [...requests].sort(), checks: [...checks].sort(), exports: [...exports].sort() };
}
export function domainFor(route) {
  if (/^\/(api\/)?admin/.test(route)) return "beheer";
  if (/^\/(api\/)?(auth|account|profile|avatar|onboarding|login|register|forgot-password|reset-password|change-password|verify-email|two-factor)(\/|$)/.test(route)) return "account";
  if (/^\/api\/v1\/native(\/|$)/.test(route)) return "native-kern";
  if (/^\/(api\/)?(dorp|dev\/versado-dorp)(\/|$)/.test(route)) return "dorp";
  if (/^\/(api\/)?(live|scrabble|word-game|word-search|jigsaw|alleskenner|chapter-guess|gezinsavond|snelle-zendeling|mysteries)(\/|$)/.test(route)) return "spelen";
  if (/^\/(api\/)?(friends|groups|uitnodiging|activity|competition|challenges|notifications|presence|social)(\/|$)/.test(route)) return "sociaal";
  if (/^\/(api\/)?(lesson|reading-lesson|study-lesson|study-|courses|chapters|scripture|intro|kids|fsy|bookmarks|practice|content|study-folder|annotations)(\/|$|-)/.test(route)) return "leren";
  if (/^\/(api\/)?(audio|podcast|search|tools|hymns|dev\/lofzangen)(\/|$)/.test(route)) return "media-hulpmiddelen";
  if (/^\/(api\/)?(privacy|cookies|uitschrijven|feedback|kompas)(\/|$)/.test(route)) return "hulp-juridisch";
  return "overig-vandaag";
}
export function collectParity(root = process.cwd()) {
  const paths = filesIn(join(root, "src")).filter(file => /\.[jt]sx?$/.test(file));
  const modules = paths.map(file => inspectModule(relative(root, file).replaceAll("\\", "/"), readFileSync(file, "utf8")));
  const byFile = new Map(modules.map(module => [module.file, module]));
  function resolveImport(file, specifier) {
    const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? join(dirname(file), specifier).replaceAll("\\", "/") : null;
    if (!base) return null;
    return [base, ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"].map(suffix => base + suffix)].find(path => byFile.has(path)) ?? null;
  }
  function dependencies(file, visited = new Set()) {
    if (visited.has(file)) return visited;
    visited.add(file);
    for (const specifier of byFile.get(file)?.imports ?? []) { const found = resolveImport(file, specifier); if (found) dependencies(found, visited); }
    return visited;
  }
  const entries = modules.filter(module => /^src\/app\//.test(module.file) && /\/(page|route)\.[jt]sx?$/.test(module.file));
  const routes = entries.map(module => {
    const route = routeFor(module.file), dependencyFiles = [...dependencies(module.file)].sort();
    const direct = module.imports.map(specifier => resolveImport(module.file, specifier)).filter(Boolean);
    return { ...module, route, kind: /\/page\./.test(module.file) ? "page" : "api", domain: domainFor(route), dependencies: dependencyFiles,
      directModules: direct, clientBoundaries: dependencyFiles.filter(file => byFile.get(file)?.boundary === "client"),
      requestEvidence: [...new Set(dependencyFiles.flatMap(file => byFile.get(file)?.requests ?? []))].sort(),
      authEvidence: module.checks,
    };
  }).sort((a, b) => a.route.localeCompare(b.route, "en"));
  const components = modules.filter(module => /\.[jt]sx$/.test(module.file) && !/\/api\//.test(module.file));
  const metadata = modules.filter(module => /^src\/app\/(robots|sitemap|manifest|icon|apple-icon|opengraph-image|twitter-image)\./.test(module.file));
  const profile = byFile.get("src/lib/profileViews.ts");
  const profileSource = profile ? readFileSync(join(root, profile.file), "utf8") : "";
  const profileViews = [...profileSource.matchAll(/^  (\w+): \{ title:/gm)].map(match => `/profile?view=${match[1]}`);
  const socketSource = readFileSync(join(root, "src/server/gameServer.ts"), "utf8");
  const socketEvents = [...new Set([...socketSource.matchAll(/socket\.(?:on|once)\("([^"]+)"/g)].map(match => match[1]))].sort();
  const tests = filesIn(join(root, "tests")).map(path => relative(root, path).replaceAll("\\", "/")).filter(path => /\.(test\.[cm]?[jt]sx?|browser\.mjs|socket\.mjs)$/.test(path));
  return { schemaVersion: 1, modules, routes, components, metadata, profileViews, socketEvents, tests };
}
const cell = value => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const link = file => `[${file}](../${file})`;
export function renderInventory(inventory) {
  const pages = inventory.routes.filter(route => route.kind === "page"), apis = inventory.routes.filter(route => route.kind === "api");
  const lines = ["<!-- BEGIN NATIVE PARITY INVENTORY -->", "## Volledige broninventaris (gegenereerd)", "",
    `Gevonden: **${pages.length} pagina's**, **${apis.length} fysieke routehandlers**, **${inventory.components.length} JSX-modules**, **${inventory.profileViews.length} profiel-queryschermen**. Een catch-all route kan meerdere logische endpoints bevatten.`, "",
    "De JSON-bijlage bevat per route alle transitief bereikbare lokale modules, clientgrenzen en statische requestpaden. Dat is een afhankelijkheidsinventaris, geen autorisatiebewijs; voorwaarden per HTTP-methode blijven apart te controleren. Een Client Component kan via een gedeelde helper nog een serverafhankelijkheid hebben. Een module zonder eigen `use client` is contextafhankelijk, niet automatisch browsergeschikt.", "",
    "### Iedere webpagina", "", "Route | Bron / rendergrens | Domeinbeleid | Native scherm / status | Data- en authbewijs in bron | Testbewijs", "--- | --- | --- | --- | --- | ---"];
  for (const row of pages) {
    const partial = /^\/(login|register|forgot-password|dashboard|lesson\/\[chapterId\])$/.test(row.route);
    lines.push([`\`${row.route}\``, `${link(row.file)}; ${row.boundary === "client" ? "expliciete clientgrens" : "Server Component-entry"}`, row.domain,
      partial ? "Foundation-toestand, gedeeltelijk; geen volledige routepariteit" : "Zelfde doel-URL; ontbreekt in lokale router",
      [...row.authEvidence, ...row.directModules.filter(file => file.startsWith("src/lib/"))].map(cell).join("; ") || "Zie bron en rootlayout; nog expliciet beoordelen",
      "Webtests: JSON-index; native: geen volledig route-/apparaatbewijs",
    ].map(cell).join(" | "));
  }
  lines.push("", "### Alle API-routehandlers", "", "Endpoint | Methoden | Bron | Domein / authenticatie | Native beschikbaarheid", "--- | --- | --- | --- | ---");
  for (const row of apis) lines.push([`\`${row.route}\``, row.methods.join(", ") || "export nader beoordelen", link(row.file), `${row.domain}; ${row.authEvidence.join(", ") || "controle in bron/service nodig"}`,
    row.domain === "native-kern" ? "Bestaande begrensde catch-all; logische contracten hierboven" : "Geen algemene bearer-toegang; expliciet contract vereist",
  ].map(cell).join(" | "));
  lines.push("", "### Alle JSX-modules en expliciete clientgrenzen", "", "Module | Eigen grens | Geëxporteerde namen", "--- | --- | ---");
  for (const row of inventory.components) lines.push([link(row.file), row.boundary === "client" ? "use client" : "contextafhankelijk / server-entry waar page/layout", row.exports.join(", ") || "default/locale declaratie; zie bron"].map(cell).join(" | "));
  lines.push("", "### Aanvullende routes en gebeurtenissen", "", ...inventory.metadata.map(row => `- Metadata: ${link(row.file)}.`), "- Rewrite: `/manifest.webmanifest` → `/api/branding/manifest` (`next.config.js`).", "",
    ...inventory.profileViews.map(route => `- Profielscherm: \`${route}\` — ontbreekt als volwaardig lokaal scherm.`), "", "Socket-events (web; native handshake nog niet aanwezig):", "", ...inventory.socketEvents.map(event => `- \`${event}\``), "", "<!-- END NATIVE PARITY INVENTORY -->");
  return lines.join("\n");
}
export function updateDocument(source, generated) {
  const start = source.indexOf("<!-- BEGIN NATIVE PARITY INVENTORY -->"), end = source.indexOf("<!-- END NATIVE PARITY INVENTORY -->");
  if (start === -1 && end === -1) return source.trimEnd() + "\n\n" + generated + "\n";
  if (start === -1 || end < start) throw new Error("Onvolledige inventarismarkers; document niet overschrijven.");
  return source.slice(0, start) + generated + source.slice(end + "<!-- END NATIVE PARITY INVENTORY -->".length);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = collectParity();
  const document = "docs/NATIVE-FEATURE-PARITY.md", snapshot = "docs/native-feature-parity.inventory.json";
  const original = readFileSync(document, "utf8"), rendered = updateDocument(original, renderInventory(inventory)), json = JSON.stringify(inventory, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (original !== rendered || !existsSync(snapshot) || readFileSync(snapshot, "utf8") !== json) throw new Error("Native inventaris is verouderd. Werk de pariteitsbeoordeling bij en voer npm run native:parity:update uit.");
    console.log("Native broninventaris compleet en actueel; dit bevestigt geen functionele pariteit.");
  } else if (process.argv.includes("--write")) {
    writeFileSync(document, rendered); writeFileSync(snapshot, json);
    console.log("Native broninventaris bijgewerkt; beoordeel de statussen en blokkades afzonderlijk.");
  } else throw new Error("Kies --check of --write.");
}
