-- De onboarding moet een bevestigde privacykeuze kunnen hervatten zonder
-- bestaande accounts opnieuw te laten kiezen. De feitelijke privacywaarde
-- blijft User.shareAchievements; deze nullable datum is alleen flowstatus.
ALTER TABLE "User" ADD COLUMN "onboardingProfilePrivacyAt" TIMESTAMP(3);
