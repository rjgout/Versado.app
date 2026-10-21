-- Alleen-lezen databasegebruiker voor courses:audit en courses:repair (dry-run). Uitvoeren als databasebeheerder (bijvoorbeeld de gebruiker "bom"):
--   psql -U bom -d bom -v rolnaam=courses_ro -v wachtwoord='<kies-een-lang-willekeurig-wachtwoord>' -v database=bom -f readonly-role.sql
-- Het wachtwoord staat nergens in Git; geef het alleen mee aan psql en aan de Portainer-stackvariabele.
CREATE ROLE :"rolnaam" LOGIN PASSWORD :'wachtwoord' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 10;
-- De Prisma-client opent voor de parallelle tellingen tot 10 verbindingen (pg-poolstandaard); een lagere limiet laat de audit falen.
-- Tweede slot naast de rechten: elke sessie van deze gebruiker is alleen-lezen en kan niet eindeloos draaien.
ALTER ROLE :"rolnaam" SET default_transaction_read_only = on;
ALTER ROLE :"rolnaam" SET statement_timeout = '60s';
GRANT CONNECT ON DATABASE :"database" TO :"rolnaam";
GRANT USAGE ON SCHEMA public TO :"rolnaam";
-- Alleen de tabellen die de cursusaudit leest.
GRANT SELECT ON "Course", "CourseChapter", "CourseLesson", "ContentCollection", "UserCourseProgress", "UserCourseLessonProgress", "ExerciseSession", "StudySession", "StudyRound", "UserListOrder" TO :"rolnaam";
-- Persoonsgevoelige tabellen alleen op de kolommen die de audit nodig heeft: nooit e-mail, wachtwoordhash of feedbacktekst.
GRANT SELECT ("id", "activeCourseId") ON "User" TO :"rolnaam";
GRANT SELECT ("id", "courseId", "lessonId") ON "Feedback" TO :"rolnaam";
