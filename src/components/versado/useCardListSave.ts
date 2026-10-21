"use client";

import { useRef, useState } from "react";

/** Eén schrijfactie tegelijk, voor beide kaartoverzichten. Geen stille opslagfouten. */
export function useCardListSave() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(persist: () => Promise<void>, apply?: () => void, rollback?: () => void): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    try {
      apply?.();
      await persist();
      return true;
    } catch {
      rollback?.();
      setFailed(true);
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return { busy, failed, run };
}
