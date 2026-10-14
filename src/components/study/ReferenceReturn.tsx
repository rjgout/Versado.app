"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { useSetBackTarget } from "@/lib/backTarget";
import { jsonMutation } from "@/lib/data/mutation";
import {
  readReferenceTrip,
  clearReferenceTrips,
} from "@/lib/references/returnContext";
export default function ReferenceReturn({
  sessionKey,
}: {
  sessionKey: string;
}) {
  const search = useSearchParams(),
    path = usePathname(),
    router = useRouter(),
    t = useT();
  const key = search.get("returnKey"),
    [trip, setTrip] = useState<ReturnType<typeof readReferenceTrip>>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setTrip(key ? readReferenceTrip(key, sessionKey) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [key, sessionKey]);
  async function back() {
    if (!trip || busy) return;
    setBusy(true);
    setError(false);
    try {
      const result = await jsonMutation<{ href: string }>(
        "/api/study-references",
        {
          json: { action: "return", token: trip.token },
          headers: { "X-Reading-Session": sessionKey },
        },
        { invalidates: "contentChanged" },
      );
      clearReferenceTrips();
      router.push(result.href);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  useSetBackTarget(
    path,
    trip?.trip.originHref ?? "/courses",
    t("referencePreview.backToLesson"),
    trip
      ? () => {
          void back();
        }
      : undefined,
    Boolean(trip),
  );
  if (!trip)
    return key ? (
      <p role="status" className="text-sm text-vs-fg-2">
        {t("referencePreview.returnExpired")}
      </p>
    ) : null;
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        className="btn-secondary min-h-12 gap-2"
        onClick={() => void back()}
      >
        <ArrowLeft size={20} aria-hidden />
        {busy ? t("common.loading") : t("referencePreview.backToLesson")}
      </button>
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-vs-fg-2">
            {t("referencePreview.returnFailed")}
          </p>
          <Link
            href="/content"
            onClick={clearReferenceTrips}
            className="btn-secondary inline-flex min-h-12"
          >
            {t("contentSwitcher.picker.title")}
          </Link>
        </div>
      )}
    </div>
  );
}
