import { prisma } from "@/lib/db";

export interface GameSettingsView {
  wordGameEnabled: boolean;
  scrabbleEnabled: boolean;
  gezinsavondEnabled: boolean;
  chapterGuessEnabled: boolean;
  challengesEnabled: boolean;
  liveExercisesEnabled: boolean;
  alleskennerEnabled: boolean;
  jigsawEnabled: boolean;
  wordSearchEnabled: boolean;
  quickMissionaryEnabled: boolean;
}

const DEFAULTS: GameSettingsView = {
  wordGameEnabled: true,
  scrabbleEnabled: true,
  gezinsavondEnabled: true,
  chapterGuessEnabled: true,
  challengesEnabled: true,
  liveExercisesEnabled: true,
  alleskennerEnabled: false,
  jigsawEnabled: false,
  wordSearchEnabled: true,
  quickMissionaryEnabled: false,
};

export async function getGameSettings(): Promise<GameSettingsView> {
  const row = await prisma.gameSettings.findUnique({ where: { id: "singleton" } });
  return row ? { ...DEFAULTS, ...row } : DEFAULTS;
}

export async function updateGameSettings(patch: Partial<GameSettingsView>): Promise<GameSettingsView> {
  const row = await prisma.gameSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...patch },
    update: patch,
  });
  return row;
}
