# Inventaris van persoonsgegevens (gegenereerd uit het schema)

Gegenereerd door `scripts/privacy/personal-data-inventory.mjs` uit `prisma/schema.prisma`. **Niet met de hand bewerken**; draai
`node scripts/privacy/personal-data-inventory.mjs --write` na een schemawijziging (`--check` faalt als dit bestand verouderd is).
Er is geen database en geen productiegegeven gebruikt.

**Wat dit wel en niet is.** Dit is een feitelijke lijst van modellen die aan een `User` hangen en wat er bij het verwijderen van die gebruiker
met de rij gebeurt. Het zegt niets over wettelijke bewaartermijnen, grondslagen, logs buiten de database of back-ups: die staan in §5 als open
punten voor de eigenaar (D8). Of een veld persoonsgegeven *is*, blijft een oordeel; de lijst in §1 is een eerste indicatie op veldnaam.

## 1. Velden op `User` die waarschijnlijk persoonsgegevens zijn
`email`, `handle`, `discriminator`, `passwordHash`, `totpEnabled`, `totpSecretEncrypted`, `totpRecoveryCodes`, `uiLanguage`, `contentLanguage`, `avatarEmoji`, `avatarCharacterId`, `avatarBackgroundId`, `avatarFrameId`, `avatarDecorationId`, `avatarLightAccentId`, `timeZone`, `dailyReminderTime`, `dailyTextTime`.

## 2. Wat er bij verwijderen met rijen gebeurt (102 relaties met `User` in 163 modellen)

### 2.1 Verdwijnt mee (Cascade): 96
| Model | Veld | Verwijzing | Regel |
|---|---|---|---|
| `ActivityFeedItem` | `user` (`userId`) | verplicht | Cascade |
| `ActivityFeedReaction` | `user` (`userId`) | verplicht | Cascade |
| `ActivityReactionNotificationBatch` | `recipient` (`recipientUserId`) | verplicht | Cascade |
| `AlleskennerSeason` | `host` (`hostId`) | verplicht | Cascade |
| `AlleskennerSeasonMember` | `user` (`userId`) | verplicht | Cascade |
| `AlleskennerSeen` | `user` (`userId`) | verplicht | Cascade |
| `AlleskennerSoloRun` | `user` (`userId`) | verplicht | Cascade |
| `AuthToken` | `user` (`userId`) | verplicht | Cascade |
| `Bookmark` | `user` (`userId`) | verplicht | Cascade |
| `Challenge` | `receiver` (`receiverId`) | verplicht | Cascade |
| `Challenge` | `sender` (`senderId`) | verplicht | Cascade |
| `ChapterGuessGame` | `user` (`userId`) | verplicht | Cascade |
| `ChapterProgress` | `user` (`userId`) | verplicht | Cascade |
| `CompetitionXpEvent` | `user` (`userId`) | verplicht | Cascade |
| `ContentExerciseCredit` | `user` (`userId`) | verplicht | Cascade |
| `ContentProgress` | `user` (`userId`) | verplicht | Cascade |
| `DorpAction` | `user` (`userId`) | verplicht | Cascade |
| `DorpGift` | `receiver` (`receiverId`) | verplicht | Cascade |
| `DorpGift` | `sender` (`senderId`) | verplicht | Cascade |
| `DorpMember` | `user` (`userId`) | verplicht | Cascade |
| `DorpMoveRequest` | `requester` (`requesterId`) | verplicht | Cascade |
| `DorpOwnedObject` | `user` (`userId`) | verplicht | Cascade |
| `DorpPath` | `user` (`userId`) | verplicht | Cascade |
| `DorpVillage` | `owner` (`ownerId`) | optioneel | Cascade |
| `ExerciseAttempt` | `user` (`userId`) | verplicht | Cascade |
| `ExerciseSession` | `user` (`userId`) | verplicht | Cascade |
| `ExternalIdentity` | `user` (`userId`) | verplicht | Cascade |
| `FeaturedAchievement` | `user` (`userId`) | verplicht | Cascade |
| `Feedback` | `user` (`userId`) | verplicht | Cascade |
| `FreezeTransaction` | `user` (`userId`) | verplicht | Cascade |
| `Friendship` | `receiver` (`receiverId`) | verplicht | Cascade |
| `Friendship` | `sender` (`senderId`) | verplicht | Cascade |
| `FriendStreak` | `inviter` (`inviterId`) | verplicht | Cascade |
| `FriendStreak` | `userA` (`userAId`) | verplicht | Cascade |
| `FriendStreak` | `userB` (`userBId`) | verplicht | Cascade |
| `GeneesPurchase` | `user` (`userId`) | verplicht | Cascade |
| `GroupFreezeOffer` | `user` (`userId`) | verplicht | Cascade |
| `GroupInvite` | `invitee` (`inviteeId`) | verplicht | Cascade |
| `GroupInvite` | `inviter` (`inviterId`) | verplicht | Cascade |
| `GroupJoinRequest` | `user` (`userId`) | verplicht | Cascade |
| `GroupMembership` | `user` (`userId`) | verplicht | Cascade |
| `Highlight` | `user` (`userId`) | verplicht | Cascade |
| `IntroExerciseAttempt` | `user` (`userId`) | verplicht | Cascade |
| `IntroLessonProgress` | `user` (`userId`) | verplicht | Cascade |
| `KidsExerciseAttempt` | `user` (`userId`) | verplicht | Cascade |
| `KidsStoryProgress` | `user` (`userId`) | verplicht | Cascade |
| `KompasProgress` | `user` (`userId`) | verplicht | Cascade |
| `LiveGame` | `host` (`hostId`) | verplicht | Cascade |
| `LiveGameInvite` | `user` (`userId`) | verplicht | Cascade |
| `LiveGamePlayer` | `user` (`userId`) | verplicht | Cascade |
| `MysteryAttempt` | `user` (`userId`) | verplicht | Cascade |
| `MysteryProgress` | `user` (`userId`) | verplicht | Cascade |
| `NativeAuthChallenge` | `user` (`userId`) | optioneel | Cascade |
| `NativeSession` | `user` (`userId`) | verplicht | Cascade |
| `Note` | `user` (`userId`) | verplicht | Cascade |
| `Notification` | `user` (`userId`) | verplicht | Cascade |
| `Nudge` | `recipient` (`recipientId`) | verplicht | Cascade |
| `Nudge` | `sender` (`senderId`) | verplicht | Cascade |
| `PodcastEpisodeProgress` | `user` (`userId`) | verplicht | Cascade |
| `PodcastExerciseAttempt` | `user` (`userId`) | verplicht | Cascade |
| `PodcastNotificationPreference` | `user` (`userId`) | verplicht | Cascade |
| `PodcastPlaybackProgress` | `user` (`userId`) | verplicht | Cascade |
| `PushSubscription` | `user` (`userId`) | verplicht | Cascade |
| `PuzzleBestRecord` | `user` (`userId`) | verplicht | Cascade |
| `PuzzleInvite` | `from` (`fromUserId`) | verplicht | Cascade |
| `PuzzleInvite` | `to` (`toUserId`) | verplicht | Cascade |
| `PuzzleLock` | `user` (`userId`) | verplicht | Cascade |
| `PuzzleMatch` | `organizer` (`organizerId`) | verplicht | Cascade |
| `PuzzleMatchParticipant` | `user` (`userId`) | verplicht | Cascade |
| `PuzzlePersonalRecord` | `user` (`userId`) | verplicht | Cascade |
| `PuzzleSession` | `owner` (`ownerId`) | verplicht | Cascade |
| `PuzzleSessionParticipant` | `user` (`userId`) | verplicht | Cascade |
| `QuickMissionaryDuoResult` | `userA` (`userAId`) | verplicht | Cascade |
| `QuickMissionaryDuoResult` | `userB` (`userBId`) | verplicht | Cascade |
| `QuickMissionaryReviveProgress` | `user` (`userId`) | verplicht | Cascade |
| `QuickMissionaryReviveSeen` | `user` (`userId`) | verplicht | Cascade |
| `QuickMissionaryRun` | `user` (`userId`) | verplicht | Cascade |
| `ReadingPosition` | `user` (`userId`) | verplicht | Cascade |
| `ReadingSession` | `user` (`userId`) | verplicht | Cascade |
| `ScrabbleGame` | `player1` (`player1Id`) | verplicht | Cascade |
| `ScrabbleGame` | `player2` (`player2Id`) | verplicht | Cascade |
| `ScrabbleMove` | `user` (`userId`) | verplicht | Cascade |
| `SeasonResult` | `user` (`userId`) | verplicht | Cascade |
| `StreakActivity` | `user` (`userId`) | verplicht | Cascade |
| `StreakDay` | `user` (`userId`) | verplicht | Cascade |
| `StudyAnswer` | `user` (`userId`) | verplicht | Cascade |
| `StudyStepProgress` | `user` (`userId`) | verplicht | Cascade |
| `UserAchievement` | `user` (`userId`) | verplicht | Cascade |
| `UserCourseLessonProgress` | `user` (`userId`) | verplicht | Cascade |
| `UserCourseProgress` | `user` (`userId`) | verplicht | Cascade |
| `UserListOrder` | `user` (`userId`) | verplicht | Cascade |
| `UserStudyContext` | `user` (`userId`) | verplicht | Cascade |
| `WeeklyScore` | `user` (`userId`) | verplicht | Cascade |
| `WordGame` | `user` (`userId`) | verplicht | Cascade |
| `WordSearchGame` | `user` (`userId`) | verplicht | Cascade |
| `XPTransaction` | `user` (`userId`) | verplicht | Cascade |

### 2.2 Blijft bestaan, verwijzing wordt leeg (SetNull): 6
Deze rijen blijven bestaan zonder koppeling aan de gebruiker. Controleer per model of de overige velden nog persoonsgegevens bevatten (bijvoorbeeld vrije tekst).
| Model | Veld | Verwijzing | Regel |
|---|---|---|---|
| `AlleskennerSeason` | `champion` (`championId`) | optioneel | SetNull |
| `AlleskennerSeason` | `deputyHost` (`deputyHostId`) | optioneel | SetNull |
| `ContentImportRun` | `createdBy` (`createdById`) | optioneel | SetNull |
| `FreezeTransaction` | `related` (`relatedId`) | optioneel | SetNull |
| `GroupJoinRequest` | `decidedBy` (`decidedById`) | optioneel | SetNull |
| `StudyPublicationAction` | `actor` (`actorId`) | optioneel | SetNull |

### 2.3 Zou het verwijderen van de gebruiker kunnen blokkeren (Restrict of NoAction): 0
Een rij die hierop verwijst, laat `user.delete` mislukken zolang zij bestaat. Alleen relevant als zulke rijen voor een gebruiker kunnen bestaan.
_Geen._

## 3. Verwijzingen zonder relatie (blijven bij verwijderen ongemoeid): 6
Tekstvelden met een naam als `userId` of `ownerId` zonder bijbehorende `@relation` naar `User`. Deze worden **niet** automatisch opgeruimd.
| Model | Veld |
|---|---|
| `Challenge` | `winnerUserId` |
| `LiveQuizAction` | `userId` |
| `PuzzleAction` | `userId` |
| `ScrabbleGame` | `turnUserId` |
| `ScrabbleGame` | `winnerUserId` |
| `SocialEvent` | `userId` |

## 4. Wat deze inventaris bewust niet bevat
Back-ups, serverlogs, proxylogs, e-mail-/SMTP-logs, externe diensten (Apple, push), de bestanden op schijf (audio, uploads) en de inhoud van vrije tekstvelden.

## 5. Open punten voor de eigenaar (D8)
1. Bewaartermijnen per categorie en de wettelijke grondslag.
2. Wat bij verwijdering bewust blijft (§2.2 en §3) en of dat in de privacyverklaring moet staan.
3. Back-ups: bewaartermijn en of verwijderde accounts uit back-ups verdwijnen of tot hun einde bestaan (NAS-instelling, eigenaar).
4. Logs: welke persoonsgegevens (IP-adres, gebruikersnaam) in server- en proxylogs staan en hoelang.
5. Externe verwerkers: Apple (Sign in with Apple), e-mailverzending, eventuele analytics (er is geen analytics in de code gevonden; de eigenaar bevestigt).
