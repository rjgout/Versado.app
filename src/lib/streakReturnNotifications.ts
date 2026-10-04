import { prisma } from "@/lib/db";
import { hhmmInZone, userTimeZone } from "@/lib/timeZone";
import { dueReturnReminder, interruptionDays } from "@/lib/learning/streakReturnRules";
import { notifyStreakReturn } from "@/lib/notify";

/** Dagintervallen volgen dezelfde lokale reeksdagen; versturen op de eigen herinneringstijd. */
export async function runStreakReturnReminders(now = new Date()): Promise<void> {
  const candidates = await prisma.user.findMany({ where: {
    streakInterruptedDay: { not: null }, streakReturnSeenAt: null,
    notifyStreakReturn: true, onlineSocketCount: 0,
    OR: [{ emailNotificationsEnabled: true }, { pushNotificationsEnabled: true }],
  } });
  for (const user of candidates) {
    if (hhmmInZone(now, userTimeZone(user)) !== user.dailyReminderTime) continue;
    const absentDays = interruptionDays(user, now);
    const due = dueReturnReminder(absentDays, user.streakReminderDay);
    if (due === null) continue;
    // Atomair claimen; concurrerende ticks sturen nooit hetzelfde moment.
    const claimed = await prisma.user.updateMany({
      where: {
        id: user.id, streakInterruptedDay: user.streakInterruptedDay,
        streakReturnSeenAt: null, notifyStreakReturn: true, onlineSocketCount: 0,
        streakReminderDay: user.streakReminderDay,
      },
      data: { streakReminderDay: due },
    });
    if (claimed.count) await notifyStreakReturn(user.id, user.streakInterruptedDay!, absentDays);
  }
}
