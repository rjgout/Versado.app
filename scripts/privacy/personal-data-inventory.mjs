// Feitelijke inventaris van persoonsgegevens uit prisma/schema.prisma (docs/PERSOONSGEGEVENS-INVENTARIS.md).
// Geen database en geen productiegegevens: alleen het schema wordt gelezen. Het resultaat zegt wat er bij het
// verwijderen van een User gebeurt (Cascade, SetNull of blokkeren) en welke verwijzingen geen relatie hebben.
// Bewaartermijnen en juridische grondslagen staan hier bewust NIET: dat zijn eigenaarsbesluiten.
// Gebruik: node scripts/privacy/personal-data-inventory.mjs [--write|--check]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SCHEMA = "prisma/schema.prisma", OUTPUT = "docs/PERSOONSGEGEVENS-INVENTARIS.md";
const PERSONAL = /^(email|handle|discriminator|passwordHash|displayName|avatar\w*|totp\w*|timeZone|uiLanguage|contentLanguage|dailyReminderTime|dailyTextTime|ip\w*|userAgent|endpoint|p256dh|auth|subject|name|message|body|comment|text)$/i;

export function parseSchema(text) {
  const models = [];
  for (const match of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = [];
    for (const line of match[2].split("\n")) {
      const field = /^\s{2}(\w+)\s+([\w]+)(\[\])?(\?)?\s*(.*?)(\/\/.*)?$/.exec(line);
      if (!field || line.trim().startsWith("@@") || line.trim().startsWith("//")) continue;
      fields.push({ name: field[1], type: field[2], list: !!field[3], optional: !!field[4], rest: field[5] ?? "" });
    }
    models.push({ name: match[1], fields });
  }
  return models;
}

export function analyse(models) {
  const names = new Set(models.map((model) => model.name));
  const user = models.find((model) => model.name === "User");
  const relations = [], looseReferences = [];
  for (const model of models) {
    if (model.name === "User") continue;
    const relationFields = new Set();
    for (const field of model.fields) {
      if (field.type !== "User" || field.list) continue;
      const onDelete = /onDelete:\s*(\w+)/.exec(field.rest)?.[1] ?? null;
      const scalar = /fields:\s*\[(\w+)\]/.exec(field.rest)?.[1];
      if (scalar) relationFields.add(scalar);
      // Zonder expliciete regel kiest Prisma: verplicht = Restrict (blokkeert verwijderen), optioneel = SetNull.
      const effective = onDelete ?? (field.optional ? "SetNull (standaard)" : "Restrict (standaard)");
      relations.push({ model: model.name, field: field.name, scalar, optional: field.optional, onDelete: effective, explicit: !!onDelete });
    }
    for (const field of model.fields) {
      if (field.type === "String" && /(^|[a-z])(userId|ownerId|authorId|creatorId|hostId|senderId|recipientId|inviterId|inviteeId|createdById|updatedById)$/i.test(field.name) && !relationFields.has(field.name))
        looseReferences.push({ model: model.name, field: field.name });
    }
  }
  const personalUserFields = user.fields.filter((field) => PERSONAL.test(field.name) && !names.has(field.type)).map((field) => field.name);
  return { relations, looseReferences, personalUserFields, modelCount: models.length };
}

export function render(result) {
  const group = (predicate) => result.relations.filter(predicate).sort((a, b) => a.model.localeCompare(b.model) || a.field.localeCompare(b.field));
  const cascade = group((r) => r.onDelete === "Cascade");
  const setNull = group((r) => r.onDelete.startsWith("SetNull"));
  const blocking = group((r) => !r.onDelete.startsWith("SetNull") && r.onDelete !== "Cascade");
  const table = (rows) => rows.length ? ["| Model | Veld | Verwijzing | Regel |", "|---|---|---|---|", ...rows.map((r) => `| \`${r.model}\` | \`${r.field}\`${r.scalar ? ` (\`${r.scalar}\`)` : ""} | ${r.optional ? "optioneel" : "verplicht"} | ${r.onDelete}${r.explicit ? "" : " — impliciet"} |`)].join("\n") : "_Geen._";
  return `# Inventaris van persoonsgegevens (gegenereerd uit het schema)

Gegenereerd door \`scripts/privacy/personal-data-inventory.mjs\` uit \`prisma/schema.prisma\`. **Niet met de hand bewerken**; draai
\`node scripts/privacy/personal-data-inventory.mjs --write\` na een schemawijziging (\`--check\` faalt als dit bestand verouderd is).
Er is geen database en geen productiegegeven gebruikt.

**Wat dit wel en niet is.** Dit is een feitelijke lijst van modellen die aan een \`User\` hangen en wat er bij het verwijderen van die gebruiker
met de rij gebeurt. Het zegt niets over wettelijke bewaartermijnen, grondslagen, logs buiten de database of back-ups: die staan in §5 als open
punten voor de eigenaar (D8). Of een veld persoonsgegeven *is*, blijft een oordeel; de lijst in §1 is een eerste indicatie op veldnaam.

## 1. Velden op \`User\` die waarschijnlijk persoonsgegevens zijn
${result.personalUserFields.map((name) => `\`${name}\``).join(", ")}.

## 2. Wat er bij verwijderen met rijen gebeurt (${result.relations.length} relaties met \`User\` in ${result.modelCount} modellen)

### 2.1 Verdwijnt mee (Cascade): ${cascade.length}
${table(cascade)}

### 2.2 Blijft bestaan, verwijzing wordt leeg (SetNull): ${setNull.length}
Deze rijen blijven bestaan zonder koppeling aan de gebruiker. Controleer per model of de overige velden nog persoonsgegevens bevatten (bijvoorbeeld vrije tekst).
${table(setNull)}

### 2.3 Zou het verwijderen van de gebruiker kunnen blokkeren (Restrict of NoAction): ${blocking.length}
Een rij die hierop verwijst, laat \`user.delete\` mislukken zolang zij bestaat. Alleen relevant als zulke rijen voor een gebruiker kunnen bestaan.
${table(blocking)}

## 3. Verwijzingen zonder relatie (blijven bij verwijderen ongemoeid): ${result.looseReferences.length}
Tekstvelden met een naam als \`userId\` of \`ownerId\` zonder bijbehorende \`@relation\` naar \`User\`. Deze worden **niet** automatisch opgeruimd.
${result.looseReferences.length ? ["| Model | Veld |", "|---|---|", ...result.looseReferences.sort((a, b) => a.model.localeCompare(b.model)).map((r) => `| \`${r.model}\` | \`${r.field}\` |`)].join("\n") : "_Geen._"}

## 4. Wat deze inventaris bewust niet bevat
Back-ups, serverlogs, proxylogs, e-mail-/SMTP-logs, externe diensten (Apple, push), de bestanden op schijf (audio, uploads) en de inhoud van vrije tekstvelden.

## 5. Open punten voor de eigenaar (D8)
1. Bewaartermijnen per categorie en de wettelijke grondslag.
2. Wat bij verwijdering bewust blijft (§2.2 en §3) en of dat in de privacyverklaring moet staan.
3. Back-ups: bewaartermijn en of verwijderde accounts uit back-ups verdwijnen of tot hun einde bestaan (NAS-instelling, eigenaar).
4. Logs: welke persoonsgegevens (IP-adres, gebruikersnaam) in server- en proxylogs staan en hoelang.
5. Externe verwerkers: Apple (Sign in with Apple), e-mailverzending, eventuele analytics (er is geen analytics in de code gevonden; de eigenaar bevestigt).
`;
}

if (process.argv[1] && process.argv[1].endsWith("personal-data-inventory.mjs")) {
  const output = render(analyse(parseSchema(readFileSync(SCHEMA, "utf8"))));
  const mode = process.argv[2];
  if (mode === "--write") { writeFileSync(OUTPUT, output); console.log(`${OUTPUT} bijgewerkt.`); }
  else if (mode === "--check") {
    if (!existsSync(OUTPUT) || readFileSync(OUTPUT, "utf8") !== output) { console.error(`${OUTPUT} is verouderd; draai --write.`); process.exit(1); }
    console.log("Inventaris van persoonsgegevens is actueel.");
  } else process.stdout.write(output);
}
