import KompasTopicView from "@/components/kompas/KompasTopicView";
import ActionsClient from "@/components/ActionsClient";
import LessonFlow from "@/components/LessonFlow";
import GameView0 from "@/components/alleskenner/AlleskennerRoom";
import GameView1 from "@/components/alleskenner/SoloClient";
import GameView2 from "@/components/alleskenner/AlleskennerSetupClient";
import GameView3 from "@/components/alleskenner/SeasonClient";
import GameView4 from "@/components/alleskenner/SeasonListClient";
import GameView5 from "@/components/ChallengesClient";
import GameView6 from "@/components/ChapterGuessSetupClient";
import GameView7 from "@/components/ChapterGuessSoloClient";
import GameView8 from "@/components/FamilyGameSetupClient";
import GameView9 from "@/components/puzzle/PuzzleHistoryClient";
import GameView10 from "@/components/JigsawV2Client";
import GameView11 from "@/components/puzzle/LeaderboardClient";
import GameView12 from "@/components/puzzle/RecordsClient";
import GameView13 from "@/components/puzzle/CoopClient";
import GameView14 from "@/components/puzzle/MatchClient";
import GameView15 from "@/components/GameRoom";
import GameView16 from "@/components/ChapterGuessGameRoom";
import GameView17 from "@/components/FamilyGameRoom";
import GameView18 from "@/components/study/StudyRoom";
import GameView19 from "@/components/LiveLobbyForm";
import GameView20 from "@/components/mysteries/MysteryOverviewView";
import GameView21 from "@/components/ScrabbleBoardClient";
import GameView22 from "@/components/ScrabbleListClient";
import GameView23 from "@/components/snelleZendeling/StartClient";
import GameView24 from "@/components/snelleZendeling/RunClient";
import GameView25 from "@/components/snelleZendeling/TogetherRoom";
import GameView26 from "@/components/WordGameClient";
import GameView27 from "@/components/WordSearchClient";
import {MysteryClient as GameView28} from "@/components/mysteries/Mystery001aClient";
import GameView29 from "@/components/mysteries/MysteryDetailView";

/** Vaste, lokaal gebundelde schermen; dezelfde componenten als de webapp. */
export const GAME_VIEWS = {
"gameGuide": KompasTopicView,
"actions": ActionsClient,
"chapterLesson":LessonFlow,
"alleskennerRoom": GameView0,
"alleskennerSolo": GameView1,
"alleskennerSetup": GameView2,
"alleskennerSeason": GameView3,
"alleskennerSeasons": GameView4,
"challenges": GameView5,
"chapterSetup": GameView6,
"chapterSolo": GameView7,
"familySetup": GameView8,
"puzzleHistory": GameView9,
"puzzleCatalogue": GameView10,
"puzzleLeaderboard": GameView11,
"puzzleRecords": GameView12,
"puzzleCoop": GameView13,
"puzzleMatch": GameView14,
"quizRoom": GameView15,
"chapterRoom": GameView16,
"familyRoom": GameView17,
"studyRoom": GameView18,
"hub": GameView19,
"mysteryOverview": GameView20,
"wordDuel": GameView21,
"wordDuels": GameView22,
"flightStart": GameView23,
"flightRun": GameView24,
"flightTogether": GameView25,
"wordOfDay": GameView26,
"wordSearch": GameView27,
"mysteryPlay": GameView28,
"mysteryDetail": GameView29
} as const;
