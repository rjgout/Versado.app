// Vaste collectie-id's zonder afhankelijkheden (geen databaseclient), zodat ook scripts en de eager-keten ze veilig kunnen importeren.
// contentCollections.ts exporteert ze opnieuw voor de rest van de app.

/** Vaste id uit migratie 20260922120000_content_collections: de oorspronkelijke Boek-van-Mormon-collectie. */
export const BOM_COLLECTION_ID = "content_bom";

/** Audio V2-tekstuitgaven: uitsluitend verborgen tekst, geen automatische cursussen of oefeningen. */
export const AUDIO_ONLY_TEXT_EDITION_IDS = ["dc", "pgp"].flatMap((work) => ["de", "fr", "es"].map((language) => `content_${work}_${language}`));
