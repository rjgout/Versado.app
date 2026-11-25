import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { analyse, parseSchema, render } from "../scripts/privacy/personal-data-inventory.mjs";

const sample = `
model User {
  id String @id
  email String @unique
  handle String
}
model Kept {
  id String @id
  userId String
}
model Gone {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model Detached {
  id String @id
  ownerId String?
  owner User? @relation(fields: [ownerId], references: [id], onDelete: SetNull)
}
model Implicit {
  id String @id
  userId String
  user User @relation(fields: [userId], references: [id])
}
model Optional {
  id String @id
  userId String?
  user User? @relation(fields: [userId], references: [id])
}
`;

test("inventaris onderscheidt Cascade, SetNull, impliciete Restrict/SetNull en verwijzingen zonder relatie", () => {
  const result = analyse(parseSchema(sample));
  const rule = (model) => result.relations.find((relation) => relation.model === model);
  assert.equal(rule("Gone").onDelete, "Cascade");
  assert.equal(rule("Detached").onDelete, "SetNull");
  assert.equal(rule("Implicit").onDelete, "Restrict (standaard)", "een verplichte relatie zonder regel kan het verwijderen blokkeren");
  assert.equal(rule("Optional").onDelete, "SetNull (standaard)");
  assert.deepEqual(result.looseReferences, [{ model: "Kept", field: "userId" }], "alleen de verwijzing zonder relatie");
  assert.deepEqual(result.personalUserFields, ["email", "handle"]);
  const text = render(result);
  assert.match(text, /### 2\.3[^\n]*: 1\n/);
  assert.match(text, /Restrict \(standaard\)/);
});

test("de gecommitte inventaris komt exact overeen met het huidige schema (geen database, geen productiegegevens)", () => {
  const generated = render(analyse(parseSchema(readFileSync("prisma/schema.prisma", "utf8"))));
  assert.equal(readFileSync("docs/PERSOONSGEGEVENS-INVENTARIS.md", "utf8"), generated, "draai: node scripts/privacy/personal-data-inventory.mjs --write");
  assert.doesNotMatch(generated, /bewaartermijn van \d|dagen bewaard|jaar bewaard/i, "geen verzonnen bewaartermijnen");
});
