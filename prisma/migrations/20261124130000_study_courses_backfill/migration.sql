-- Cursussen voor een reeds geïmporteerde CFM-collectie. Een verse installatie krijgt ze bij het importeren
-- (ensureCfmDraftCollection). Er wordt niemand ingeschreven en niets zichtbaar gemaakt: de collectie blijft verborgen
-- tot de beheerder haar vrijgeeft, en bestaande studiegegevens (annotaties, leesposities, stapvoortgang) blijven ongemoeid.
INSERT INTO "Course" ("id", "slug", "type", "name", "description", "order", "contentCollectionId", "enabled")
SELECT 'course-' || v.slug, v.slug, v.type::"CourseType", v.name, v.description, v.sort, c."id", true
FROM "ContentCollection" c
CROSS JOIN (VALUES
  ('kom-dan-en-volg-mij-stap-voor-stap', 'STUDY_STEPS', 'Stap voor stap', 'Elke week in zes stappen, in je eigen tempo.', 0),
  ('kom-dan-en-volg-mij-vrije-studie', 'STUDY_FREE', 'Vrije studie', 'De studie van de week als één doorlopende tekst.', 1)
) AS v(slug, type, name, description, sort)
WHERE c."id" = 'content_cfm_ot_2026_nl'
ON CONFLICT ("slug") DO NOTHING;
