import { getTodayProgram } from "@/lib/todayProgram.server";
import TodayProgramView from "@/components/today/TodayProgramView";
import LiveRefresh from "@/components/LiveRefresh";
export default async function ProgramContextPanel({ actor }: { actor: { id: string; isAdmin: boolean } }) {
  const program = await getTodayProgram(actor);
  if (!program) return null;
  return <><LiveRefresh scopes={["studyContext", "studyContent", "content", "progress"]} token={program.token}/><TodayProgramView program={program}/></>;
}
