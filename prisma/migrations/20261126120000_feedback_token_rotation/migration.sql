-- Oude respondTokens zijn via de gebruikers-API blootgesteld. Alleen deze
-- beheercapabilities intrekken; feedback, status en gebruikersdata behouden.
-- Bestaande e-maillinks vervallen; het geauthenticeerde beheer blijft werken.
UPDATE "Feedback"
SET "respondToken" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
