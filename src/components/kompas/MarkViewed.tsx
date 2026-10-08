"use client";

import { useEffect } from "react";
import { recordKompasState } from "@/lib/kompas/client";

/** Onthoudt dat een uitleg geopend is, zodat Kompas hem niet nog eens aanbiedt. Rendert niets. */
export default function MarkViewed({ topicId, scope }: { topicId: string; scope: string }) {
  useEffect(() => {
    void recordKompasState({ topicId, scope, kind: "GUIDE", status: "VIEWED" });
  }, [topicId, scope]);
  return null;
}
