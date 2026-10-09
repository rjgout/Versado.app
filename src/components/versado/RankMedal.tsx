"use client";

import VisualIdentityIcon from "@/components/versado/VisualIdentityIcon";
import { podiumAssetForRank } from "@/lib/visualIdentityAssets";

export default function RankMedal({ rank, label, className = "h-7 w-7 text-sm" }: { rank: 1 | 2 | 3; label?: string; className?: string }) {
  return (
    <span
      className={["relative inline-flex shrink-0 items-center justify-center", className].join(" ")}
      aria-label={label}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
    >
      <VisualIdentityIcon asset={podiumAssetForRank(rank)} className="absolute inset-0 h-full w-full" sizes="48px" />
      <span className="relative z-10 text-[0.72em] font-extrabold leading-none text-slate-950 dark:text-slate-950">{rank}</span>
    </span>
  );
}
