-- De bestaande Nederlandse hoofdstukvraag is ook de eerste Genees-vraag.
-- Maak uitsluitend haar drie afleiders inhoudelijk even volledig als het
-- correcte antwoord; correctheid en overige cursuscontent veranderen niet.
UPDATE "QuestionOption" AS option
SET "label" = CASE option."label"
  WHEN 'Nephi beschrijft een oorlog tussen twee koninkrijken.'
    THEN 'Nephi beschrijft hoe een oorlog tussen twee koninkrijken Jeruzalem bedreigt en zijn familie tot handelen dwingt.'
  WHEN 'Nephi vertelt over een groot feest in Jeruzalem.'
    THEN 'Nephi vertelt hoe een groot feest in Jeruzalem zijn familie samenbrengt en aanleiding geeft om hun geschiedenis vast te leggen.'
  WHEN 'Nephi geeft een overzicht van de wetten van Mozes.'
    THEN 'Nephi geeft een overzicht van de wetten van Mozes en legt uit hoe zijn volk die wetten in Jeruzalem naleeft.'
  ELSE option."label"
END
FROM "Exercise" AS exercise
WHERE option."exerciseId" = exercise."id"
  AND exercise."verseRef" = '1 Nephi 1'
  AND exercise."prompt" = 'Wat is de kernboodschap van dit hoofdstuk?'
  AND option."label" IN (
    'Nephi beschrijft een oorlog tussen twee koninkrijken.',
    'Nephi vertelt over een groot feest in Jeruzalem.',
    'Nephi geeft een overzicht van de wetten van Mozes.'
  );
