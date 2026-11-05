"use client";
import CfmTodayCard from "@/components/study/CfmTodayCard";
import ProgramSummaryView from "@/components/study/ProgramSummaryView";
import type { getTodayProgram } from "@/lib/todayProgram.server";
export type TodayProgram = Awaited<ReturnType<typeof getTodayProgram>>;
export default function TodayProgramView({ program }: { program: TodayProgram }) {
  if (!program) return null;
  return <div className="min-w-0">{program.body.kind === "cfm" ? <CfmTodayCard {...program.body.props}/> : <ProgramSummaryView data={program.body.props}/>}</div>;
}
