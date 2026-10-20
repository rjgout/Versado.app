-- "Kom dan en volg Mij" wordt een gewone cursus in Leren: één cursus per leeswijze (Stap voor stap, Vrije studie).
-- Alleen nieuwe enumwaarden; de cursussen zelf staan in de volgende migratie (een nieuwe waarde is pas daarna bruikbaar).
ALTER TYPE "CourseType" ADD VALUE IF NOT EXISTS 'STUDY_STEPS';
ALTER TYPE "CourseType" ADD VALUE IF NOT EXISTS 'STUDY_FREE';
