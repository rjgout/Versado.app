"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTag } from "@/lib/handle";
import { enableBrowserPush, isPushSupported } from "@/lib/pushClient";
import { isStandalone } from "@/lib/pwaInstall";
import InstallAppCard from "@/components/InstallAppCard";
import UserTag from "@/components/UserTag";
import { useT } from "@/components/I18nProvider";
import SystemIcon from "@/components/versado/SystemIcon";
import CompanionPicker, { companionName } from "@/components/versado/CompanionPicker";
import MascotSlot from "@/components/versado/MascotSlot";
import PersonalMascot, { useCompanion } from "@/components/versado/PersonalMascot";
import { guideMascotState } from "@/lib/kompas/mascot";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";
import { getCharacterAsset } from "@/lib/characterAssets";
import { START_AVATAR_CHARACTER_IDS } from "@/lib/avatarUnlocks";
import type { CanonicalCharacterId } from "@/lib/characterAssets";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import { KompasIcon } from "@/components/kompas/KompasIcon";
import { BookOpen, Check, Gamepad2, Layers } from "lucide-react";
import type { PersonalMascotCharacter } from "@/lib/mascots";

interface OnboardingClientProps {
  email: string;
  searchableByEmail: boolean;
  shareOnlineStatus: boolean;
  pushNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
  notifyDailyText: boolean;
  dailyTextTime: string;
  emailConfigured: boolean;
  /** Huidige gids; voor een nieuwe gebruiker is dat de standaard, nog geen eigen keuze. */
  companion: PersonalMascotCharacter;
  /** Rondleiding al eens gezien (opnieuw geopend via het profiel): de gids is dan al gekozen. */
  alreadyOnboarded: boolean;
  /** Bestaande accounts zonder avatar krijgen alleen de gerichte keuze. */
  avatarCharacterId: string | null;
  /** Alleen voor nieuwe accounts: voorkomt dat een bevestigde keuze bij hervatten opnieuw verschijnt. */
  profilePrivacyChosen: boolean;
  avatarOnly: boolean;
  /** Is de contentkiezer er voor deze gebruiker? Zo niet, dan noemt de kennismaking hem ook niet. */
  switcherEnabled: boolean;
}

type StepId = "kennis" | "personage" | "privacy" | "gids" | "kompas" | "webapp" | "uitleg" | "vrienden" | "online-status" | "notificaties";

// "kompas" is de korte kennismaking met Versado (Versado Kompas, docs/KOMPAS.md):
// één stap, direct na de keuze van de gids, met de mogelijkheid om meteen iets te proberen.
const BASE_STEPS: StepId[] = ["gids", "kompas", "webapp", "uitleg", "vrienden", "online-status", "notificaties"];

/**
 * De bestaande onboarding blijft de uitleg en instellingen verzorgen. Nieuwe
 * accounts kiezen daarvoor eerst hun Schriftpersonage en profielprivacy.
 * "Overslaan" beëindigt de hele flow (niet alleen de huidige
 * stap) en markeert 'm — via /api/onboarding/complete — als gezien, zodat
 * dashboard/page.tsx 'm niet opnieuw automatisch toont. Handmatig herstarten
 * kan altijd via de knop op het profiel (die gewoon naar deze pagina linkt).
 */
export default function OnboardingClient({
  email,
  searchableByEmail,
  shareOnlineStatus,
  pushNotificationsEnabled,
  emailNotificationsEnabled,
  notifyDailyText,
  dailyTextTime,
  emailConfigured,
  companion,
  alreadyOnboarded,
  avatarCharacterId,
  profilePrivacyChosen,
  avatarOnly,
  switcherEnabled,
}: OnboardingClientProps) {
  const router = useRouter();
  const t = useT();
  const [ready, setReady] = useState(false);
  const [steps, setSteps] = useState<StepId[]>([]);
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Een nieuwe gebruiker kiest zelf een gids voordat de rondleiding klaar is;
  // daarom kan "Overslaan" pas na die keuze. Bij opnieuw bekijken is er al een.
  const [companionChosen, setCompanionChosen] = useState(alreadyOnboarded);
  const [avatarChosen, setAvatarChosen] = useState(Boolean(avatarCharacterId));
  const [privacyChosen, setPrivacyChosen] = useState(alreadyOnboarded || profilePrivacyChosen);

  useEffect(() => {
    const requiredSteps: StepId[] = avatarOnly
      ? ["personage"]
      : [
          "kennis",
          ...(!avatarCharacterId ? ["personage" as const] : []),
          ...(!alreadyOnboarded && !profilePrivacyChosen ? ["privacy" as const] : []),
          ...BASE_STEPS,
        ];
    setSteps(isStandalone() ? requiredSteps.filter((s) => s !== "webapp") : requiredSteps);
    setReady(true);
  }, [alreadyOnboarded, avatarCharacterId, avatarOnly, profilePrivacyChosen]);

  // Kompas bewaart of de kennismaking getoond is, zodat dezelfde uitleg daarna niet nogmaals vanzelf verschijnt.
  async function finish(destination = "/dashboard") {
    setFinishing(true);
    setFinishError(null);
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kompasSeen: steps.indexOf("kompas") >= 0 && steps.indexOf("kompas") <= index }),
    }).catch(() => null);
    if (!response?.ok) {
      setFinishing(false);
      setFinishError(t("onboarding.completeFailed"));
      return;
    }
    router.push(destination);
    router.refresh();
  }

  function next() {
    if (index + 1 >= steps.length) finish();
    else setIndex(index + 1);
  }

  if (!ready) return <p className="text-slate-400 dark:text-slate-500 text-center py-12">{t("common.loading")}</p>;

  const step = steps[index];

  return (
    // De gidskeuze krijgt meer breedte: drie kaarten naast elkaar met een mascotte die groot genoeg is.
    <div className={`${step === "gids" ? "max-w-3xl" : "max-w-xl"} mx-auto flex w-full flex-col gap-6 py-6`}>
      <div className="flex items-center gap-1.5 justify-center">
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? "w-8 bg-brand-500" : "w-4 bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>

      {step === "kennis" && <KennisStep onNext={next} />}
      {step === "personage" && (
        <PersonageStep
          initial={avatarCharacterId}
          onSaved={() => {
            setAvatarChosen(true);
            next();
          }}
        />
      )}
      {step === "privacy" && (
        <ProfilePrivacyStep
          initial={profilePrivacyChosen ? true : false}
          onSaved={() => {
            setPrivacyChosen(true);
            next();
          }}
        />
      )}
      {step === "gids" && (
        <GidsStep
          initial={alreadyOnboarded ? companion : null}
          onSaved={() => {
            setCompanionChosen(true);
            next();
          }}
        />
      )}
      {step === "kompas" && <KompasStep switcherEnabled={switcherEnabled} onNext={next} onTry={(href) => finish(href)} busy={finishing} />}
      {step === "webapp" && <WebappStep onNext={next} />}
      {step === "uitleg" && <UitlegStep onNext={next} />}
      {step === "vrienden" && <VriendenStep email={email} initialSearchable={searchableByEmail} onNext={next} />}
      {step === "online-status" && <OnlineStatusStep initialShareOnlineStatus={shareOnlineStatus} onNext={next} />}
      {step === "notificaties" && (
        <NotificatiesStep
          emailConfigured={emailConfigured}
          initialPush={pushNotificationsEnabled}
          initialEmail={emailNotificationsEnabled}
          initialDailyText={notifyDailyText}
          initialDailyTextTime={dailyTextTime}
          onNext={next}
          finishing={finishing}
        />
      )}

      {finishError && <p className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-center text-sm font-semibold text-red-700 dark:text-red-300" role="alert">{finishError}</p>}

      {companionChosen && avatarChosen && privacyChosen && (
        <button className="text-sm text-slate-400 dark:text-slate-500 underline self-center" onClick={() => finish()} disabled={finishing}>
          {t("onboarding.skip")}
        </button>
      )}
    </div>
  );
}

const START_CHARACTERS = START_AVATAR_CHARACTER_IDS.map((id) => getCharacterAsset(id)).filter(
  (character): character is NonNullable<ReturnType<typeof getCharacterAsset>> => Boolean(character),
);

function PersonageStep({ initial, onSaved }: { initial: string | null; onSaved: () => void }) {
  const t = useT();
  const initialChoice = START_CHARACTERS.some((character) => character.id === initial) ? initial as CanonicalCharacterId : null;
  const [choice, setChoice] = useState<CanonicalCharacterId | null>(initialChoice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = START_CHARACTERS.find((character) => character.id === choice) ?? null;

  async function save() {
    if (!choice) return;
    setSaving(true);
    setError(null);
    try {
      await liveMutation(
        () => fetchJson("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatarCharacterId: choice }) }),
        { invalidates: ["profile", "friends", "today", "competition", "activity"] },
      );
      onSaved();
    } catch {
      setError(t("onboarding.avatarSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">{t("onboarding.chooseCharacterTitle")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("onboarding.chooseCharacterText")}</p>
      </div>

      {selected && (
        <div className="card flex flex-col items-center gap-2 !bg-vs-subtle text-center" aria-live="polite">
          {/* De detailbuste is dezelfde bestaande asset als in de avatar-editor. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={selected.bustDetail} alt={selected.accessibilityLabel} draggable={false} className="h-44 w-full object-contain sm:h-52" />
          <p className="font-extrabold text-vs-fg">{selected.name}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("onboarding.chooseCharacterTitle")}>
        {START_CHARACTERS.map((character) => {
          const isSelected = choice === character.id;
          return (
            <button
              key={character.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={saving}
              onClick={() => setChoice(character.id as CanonicalCharacterId)}
              className={`relative flex min-h-44 min-w-0 flex-col items-center justify-end overflow-hidden rounded-2xl border p-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${isSelected ? "!border-vs-accent !bg-vs-accent-soft" : "border-vs-line bg-vs-surface hover:bg-vs-subtle"}`}
            >
              {isSelected && <Check className="absolute right-2 top-2 z-10 h-5 w-5 rounded-full bg-vs-accent p-0.5 text-white" aria-hidden="true" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={character.bustCompact} alt="" draggable={false} className="h-32 w-full object-contain" />
              <span className="mt-1 max-w-full break-normal text-sm font-extrabold leading-tight text-vs-fg">{character.name}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-center text-sm font-semibold text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <button type="button" className="btn-primary self-center" onClick={save} disabled={!choice || saving}>
        {saving ? t("onboarding.saving") : t("onboarding.chooseCharacterContinue")}
      </button>
    </div>
  );
}

function ProfilePrivacyStep({ initial, onSaved }: { initial: boolean; onSaved: () => void }) {
  const t = useT();
  const [shareAchievements, setShareAchievements] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await liveMutation(
        () => fetchJson("/api/onboarding/profile-privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareAchievements }) }),
        { invalidates: ["profile", "friends"] },
      );
      onSaved();
    } catch {
      setError(t("onboarding.privacySaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">{t("onboarding.profilePrivacyTitle")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("onboarding.profilePrivacyText")}</p>
      </div>
      <div className="flex flex-col gap-3">
        <button type="button" className={`card text-left !border-2 ${!shareAchievements ? "!border-brand-500 !bg-brand-50 dark:!bg-slate-800" : "!border-transparent"}`} onClick={() => setShareAchievements(false)} disabled={saving} aria-pressed={!shareAchievements}>
          <span className="font-extrabold dark:text-slate-100">{t("onboarding.profilePrivacyPrivate")}</span>
          <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{t("onboarding.profilePrivacyPrivateText")}</span>
        </button>
        <button type="button" className={`card text-left !border-2 ${shareAchievements ? "!border-brand-500 !bg-brand-50 dark:!bg-slate-800" : "!border-transparent"}`} onClick={() => setShareAchievements(true)} disabled={saving} aria-pressed={shareAchievements}>
          <span className="font-extrabold dark:text-slate-100">{t("onboarding.profilePrivacyFriends")}</span>
          <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{t("onboarding.profilePrivacyFriendsText")}</span>
        </button>
      </div>
      {error && <p className="text-center text-sm font-semibold text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <button type="button" className="btn-primary self-center" onClick={save} disabled={saving}>
        {saving ? t("onboarding.saving") : t("onboarding.next")}
      </button>
    </div>
  );
}

function GidsStep({ initial, onSaved }: { initial: PersonalMascotCharacter | null; onSaved: () => void }) {
  const t = useT();
  const { setCharacter } = useCompanion();
  const [choice, setChoice] = useState<PersonalMascotCharacter | null>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!choice) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companion: choice }),
    }).catch(() => null);
    setSaving(false);
    // Pas na een bevestigde opslag verder; anders blijft de keuze staan om opnieuw te proberen.
    if (!res?.ok) {
      setError(t("companion.saveFailed"));
      return;
    }
    setCharacter(choice);
    onSaved();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-center">
        <h1 id="onboarding-gids" className="text-xl font-extrabold text-brand-800 dark:text-brand-300">{t("companion.chooseTitle")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("companion.chooseIntro")}</p>
      </div>
      <CompanionPicker name="onboarding-companion" legend={t("companion.legend")} value={choice} onSelect={setChoice} disabled={saving} size="large" />
      {error && (
        <p role="alert" className="text-center text-sm font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button className="btn-primary" onClick={save} disabled={!choice || saving}>
        {saving ? t("courses.busy") : choice ? t("companion.continueWith", { name: companionName(choice) }) : t("companion.chooseFirst")}
      </button>
    </div>
  );
}

const KNOWLEDGE_OPTIONS = [
  { level: "NEVER", key: "never" },
  { level: "SOME", key: "some" },
  { level: "READ_BEFORE", key: "readBefore" },
  { level: "UNSURE", key: "unsure" },
] as const;

function KennisStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  const [saving, setSaving] = useState(false);

  async function choose(level: (typeof KNOWLEDGE_OPTIONS)[number]["level"]) {
    setSaving(true);
    await fetch("/api/onboarding/knowledge-level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    }).catch(() => {});
    setSaving(false);
    onNext();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Gezamenlijk welkom van de familie; de eigen gids wordt in de volgende stap gekozen. */}
      <div className="mx-auto aspect-square w-[clamp(160px,48vw,13rem)] vs-decor">
        <MascotSlot character="family" state="huddle" size={208} fill />
      </div>
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300 text-center">{t("onboarding.welcome")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
        {t("onboarding.knowledgeQuestion")}
      </p>
      <div className="flex flex-col gap-2">
        {KNOWLEDGE_OPTIONS.map((opt) => (
          <button
            key={opt.level}
            className="card text-left hover:!border-brand-300 !border-2 !border-transparent dark:text-slate-100"
            disabled={saving}
            onClick={() => choose(opt.level)}
          >
            {t(`onboarding.knowledge.${opt.key}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * De korte kennismaking: wat Versado is, Leren, Spelen, de contentkiezer en
 * waar je verdere uitleg vindt. De twee knoppen onderaan sluiten de
 * kennismaking af en openen meteen een echte pagina: de rest (vrienden,
 * meldingen) blijft te vinden in het profiel.
 */
function KompasStep({ switcherEnabled, onNext, onTry, busy }: { switcherEnabled: boolean; onNext: () => void; onTry: (href: string) => void; busy: boolean }) {
  const t = useT();
  const { character } = useCompanion();
  const rows = [
    { icon: <BookOpen className="h-6 w-6" aria-hidden />, title: t("kompas.onboarding.learnTitle"), text: t("kompas.onboarding.learnText") },
    { icon: <Gamepad2 className="h-6 w-6" aria-hidden />, title: t("kompas.onboarding.playTitle"), text: t("kompas.onboarding.playText") },
    ...(switcherEnabled ? [{ icon: <Layers className="h-6 w-6" aria-hidden />, title: t("kompas.onboarding.switcherTitle"), text: t("kompas.onboarding.switcherText") }] : []),
    { icon: <KompasIcon className="h-6 w-6" />, title: t("kompas.onboarding.helpTitle"), text: t("kompas.onboarding.helpText") },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="aspect-square w-[clamp(80px,22vw,6.5rem)] shrink-0 vs-decor">
          <PersonalMascot state={guideMascotState(character)} size={104} fill />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">{t("kompas.onboarding.title")}</h1>
          <p className="text-base text-slate-600 dark:text-slate-300">{t("kompas.onboarding.intro")}</p>
        </div>
      </div>
      <ul className="card flex flex-col gap-4 text-left">
        {rows.map((row) => (
          <li key={row.title} className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-vs-accent-soft text-vs-accent">{row.icon}</span>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold dark:text-slate-100">{row.title}</h2>
              <p className="text-base text-slate-600 dark:text-slate-300">{row.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <p className="text-center text-sm font-bold text-slate-600 dark:text-slate-300">{t("kompas.onboarding.tryTitle")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button className="btn-secondary w-full" disabled={busy} onClick={() => onTry("/courses")}>
            {t("kompas.onboarding.tryLearn")}
          </button>
          <button className="btn-secondary w-full" disabled={busy} onClick={() => onTry("/live")}>
            {t("kompas.onboarding.tryPlay")}
          </button>
        </div>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">{t("kompas.onboarding.tryLater")}</p>
      </div>
      <button className="btn-primary self-center" onClick={onNext} disabled={busy}>
        {t("onboarding.next")}
      </button>
    </div>
  );
}

function WebappStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300 text-center">{t("onboarding.welcomeFirst")}</h1>
      <InstallAppCard />
      <button className="btn-primary self-center" onClick={onNext}>
        {t("onboarding.next")}
      </button>
    </div>
  );
}

function UitlegStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300 text-center">{t("onboarding.howItWorks")}</h1>
      <div className="card text-left flex flex-col gap-4">
        <div className="flex gap-3 items-start">
          <SystemIcon kind="streak" className="h-7 w-7 text-orange-500" fill="currentColor" aria-hidden />
          <div>
            <h3 className="font-extrabold dark:text-slate-100">{t("profile.streak")}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("onboarding.streakText")}
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <SystemIcon kind="xp" className="h-7 w-7 text-gold-500" fill="currentColor" aria-hidden />
          <div>
            <h3 className="font-extrabold dark:text-slate-100">XP</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("onboarding.xpText")}
            </p>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <span className="text-2xl">💡</span>
          <div>
            <h3 className="font-extrabold dark:text-slate-100">{t("shop.hints")}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("onboarding.hintsText")}</p>
          </div>
        </div>
      </div>
      <button className="btn-primary self-center" onClick={onNext}>
        {t("onboarding.next")}
      </button>
    </div>
  );
}

interface SearchResult {
  id: string;
  handle: string;
  discriminator: string;
}

function VriendenStep({ email, initialSearchable, onNext }: { email: string; initialSearchable: boolean; onNext: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [searchable, setSearchable] = useState(initialSearchable);
  const [savingSearchable, setSavingSearchable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const timeout = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  async function sendRequest(target: SearchResult) {
    setMessage(null);
    const res = await fetch("/api/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: target.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error ?? t("wordOfTheDay.somethingWrong"));
    } else {
      setSentTo((prev) => new Set(prev).add(target.id));
      setMessage(t("onboarding.requestSent", { tag: formatTag(target.handle, target.discriminator) }));
    }
  }

  async function toggleSearchable() {
    const next = !searchable;
    setSearchable(next);
    setSavingSearchable(true);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchableByEmail: next }),
    }).catch(() => {});
    setSavingSearchable(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300 text-center">{t("onboarding.findFriends")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
        {t("onboarding.findFriendsText")}
      </p>

      <div className="card flex flex-col gap-3">
        <input
          className="input"
          placeholder={t("onboarding.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results && results.length === 0 && query.trim().length >= 2 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">{t("friends.nobodyFound")}</p>
        )}
        {results && results.length > 0 && (
          <div className="flex flex-col gap-2">
            {results.map((r) => (
              <div key={r.id} className="flex items-center justify-between !py-2">
                <UserTag handle={r.handle} discriminator={r.discriminator} className="dark:text-slate-100" />
                <button className="btn-secondary !px-3 !py-1.5" disabled={sentTo.has(r.id)} onClick={() => sendRequest(r)}>
                  {sentTo.has(r.id) ? t("friends.sent") : t("courses.add")}
                </button>
              </div>
            ))}
          </div>
        )}
        {message && <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">{message}</p>}
      </div>

      <label className="card flex cursor-pointer items-center gap-3">
        <span className="min-w-0 flex-1 text-sm dark:text-slate-200">
          {t("profile.searchableByEmail", { email })}
          <br />
          <span className="text-slate-400 dark:text-slate-500">
            {t("onboarding.searchableHint")}
          </span>
        </span>
        <ToggleSwitch checked={searchable} onChange={toggleSearchable} disabled={savingSearchable} />
      </label>

      <button className="btn-primary self-center" onClick={onNext}>
        {t("onboarding.next")}
      </button>
    </div>
  );
}

function OnlineStatusStep({
  initialShareOnlineStatus,
  onNext,
}: {
  initialShareOnlineStatus: boolean;
  onNext: () => void;
}) {
  const t = useT();
  const [shareOnlineStatus, setShareOnlineStatus] = useState(initialShareOnlineStatus);
  const [saving, setSaving] = useState(false);

  async function saveAndContinue() {
    setSaving(true);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareOnlineStatus }),
    }).catch(() => {});
    setSaving(false);
    onNext();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300 text-center">{t("onboarding.onlineStatus")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
        {t("onboarding.onlineStatusText")}
      </p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={`card text-left !border-2 ${shareOnlineStatus ? "!border-brand-500 !bg-brand-50 dark:!bg-slate-800" : "!border-transparent"}`}
          onClick={() => setShareOnlineStatus(true)}
          disabled={saving}
          aria-pressed={shareOnlineStatus}
        >
          <div className="font-extrabold dark:text-slate-100">{t("onboarding.shareYes")}</div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("onboarding.shareYesText")}
          </div>
        </button>

        <button
          type="button"
          className={`card text-left !border-2 ${!shareOnlineStatus ? "!border-brand-500 !bg-brand-50 dark:!bg-slate-800" : "!border-transparent"}`}
          onClick={() => setShareOnlineStatus(false)}
          disabled={saving}
          aria-pressed={!shareOnlineStatus}
        >
          <div className="font-extrabold dark:text-slate-100">{t("onboarding.shareNo")}</div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("onboarding.shareNoText")}
          </div>
        </button>
      </div>

      <button className="btn-primary self-center" onClick={saveAndContinue} disabled={saving}>
        {saving ? t("onboarding.saving") : t("onboarding.next")}
      </button>
    </div>
  );
}

function NotificatiesStep({
  emailConfigured,
  initialPush,
  initialEmail,
  initialDailyText,
  initialDailyTextTime,
  onNext,
  finishing,
}: {
  emailConfigured: boolean;
  initialPush: boolean;
  initialEmail: boolean;
  initialDailyText: boolean;
  initialDailyTextTime: string;
  onNext: () => void;
  finishing: boolean;
}) {
  const t = useT();
  const [push, setPush] = useState(initialPush);
  const [email, setEmail] = useState(initialEmail);
  const [dailyText, setDailyText] = useState(initialDailyText);
  const [dailyTextTime, setDailyTextTime] = useState(initialDailyTextTime);
  const [pushError, setPushError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pushSupported = isPushSupported();

  async function enablePush() {
    setPushError(null);
    setBusy(true);
    try {
      await enableBrowserPush();
      setPush(true);
      await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pushNotificationsEnabled: true }),
      });
    } catch (e) {
      setPushError(e instanceof Error ? e.message : t("onboarding.pushFailed"));
    }
    setBusy(false);
  }

  async function toggleEmail() {
    const next = !email;
    setEmail(next);
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailNotificationsEnabled: next }),
    }).catch(() => {});
  }

  async function saveDailyText(patch: { notifyDailyText?: boolean; dailyTextTime?: string }) {
    await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  function toggleDailyText() {
    const next = !dailyText;
    setDailyText(next);
    saveDailyText({ notifyDailyText: next });
  }

  function changeDailyTextTime(value: string) {
    setDailyTextTime(value);
    saveDailyText({ dailyTextTime: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300 text-center">{t("onboarding.missNothing")}</h1>

      <div className="card text-left flex flex-col gap-3">
        <h3 className="font-extrabold dark:text-slate-100">{t("onboarding.pushTitle")}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t("onboarding.pushText")}
          {!pushSupported && t("onboarding.pushUnsupported")}
        </p>
        {push ? (
          <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">{t("onboarding.pushOn")}</p>
        ) : (
          <button className="btn-primary self-start" onClick={enablePush} disabled={busy || !pushSupported}>
            {busy ? t("courses.busy") : t("onboarding.pushEnable")}
          </button>
        )}
        {pushError && <p className="text-sm text-red-600 dark:text-red-400">{pushError}</p>}
      </div>

      {emailConfigured && (
        <label className="card flex cursor-pointer items-center gap-3 text-left">
          <span className="min-w-0 flex-1 text-sm dark:text-slate-200">
            {t("onboarding.emailTitle")}
            <br />
            <span className="text-slate-400 dark:text-slate-500">{t("onboarding.emailHint")}</span>
          </span>
          <ToggleSwitch checked={email} onChange={toggleEmail} />
        </label>
      )}

      <div className="card text-left flex flex-col gap-3">
        <label className="flex cursor-pointer items-center gap-3">
          <span className="min-w-0 flex-1 text-sm dark:text-slate-200">
            {t("onboarding.dailyTextTitle")}
            <br />
            <span className="text-slate-400 dark:text-slate-500">
              {emailConfigured ? t("onboarding.dailyTextHintEmail") : t("onboarding.dailyTextHint")}
            </span>
          </span>
          <ToggleSwitch checked={dailyText} onChange={toggleDailyText} />
        </label>
        {dailyText && (
          <label className="flex items-center gap-2 text-sm dark:text-slate-200 pl-8">
            {t("onboarding.time")}
            <input
              type="time"
              className="input !w-auto !py-1"
              value={dailyTextTime}
              onChange={(e) => e.target.value && changeDailyTextTime(e.target.value)}
            />
          </label>
        )}
      </div>

      <button className="btn-primary self-center" onClick={onNext} disabled={finishing}>
        {finishing ? t("courses.busy") : t("onboarding.done")}
      </button>
    </div>
  );
}
