"use client";

import { useState } from "react";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { useT } from "@/components/I18nProvider";
import AppSelect from "@/components/AppSelect";
import SystemIcon from "@/components/versado/SystemIcon";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { liveMutation } from "@/lib/data/mutation";


interface ShopData {
  xpTotal: number;
  hintBalance: number;
  hintPriceXp: number;
  freezeCount: number;
  freezePriceXp: number;
  geneesBalance: number;
  /** Prijs van de volgende Genees: 100 + voorraad × 25, bepaald door de server. */
  geneesPriceXp: number;
}

interface GeneesPurchaseResult {
  xpTotal: number;
  geneesBalance: number;
  priceXp: number;
  nextPriceXp: number;
}

export default function ShopClient() {
  const t = useT();
  // XP en voorraad komen van de server; ze veranderen ook buiten de winkel (een Genees gebruiken of kopen
  // in het spel, XP verdienen). Korte staleTime: bij terugkomen altijd actueel. Zie docs/DATA-REFRESH.md.
  const shop = useLiveQuery<ShopData>(["shop"], () => fetchJson<ShopData>("/api/shop"), { scopes: ["xp", "games"], staleTime: 1_000 });
  const data = shop.data ?? null;
  const setData = shop.setData;
  const [buyingGenees, setBuyingGenees] = useState(false);
  const [geneesMessage, setGeneesMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [hintQuantity, setHintQuantity] = useState(1);
  const [buyingHints, setBuyingHints] = useState(false);
  const [hintMessage, setHintMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [freezeQuantity, setFreezeQuantity] = useState(1);
  const [buyingFreezes, setBuyingFreezes] = useState(false);
  const [freezeMessage, setFreezeMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  /**
   * Eén Genees per klik. Het resultaat komt van de server (saldo, voorraad en de nieuwe prijs):
   * er is geen optimistische tussenstand die kan afwijken. De sleutel maakt een dubbele klik of een
   * netwerkherhaling onschadelijk.
   */
  async function buyGenees() {
    if (!data || buyingGenees) return;
    setBuyingGenees(true);
    setGeneesMessage(null);
    try {
      const result = await liveMutation(
        () =>
          fetchJson<GeneesPurchaseResult>("/api/shop/genees", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
          }),
        {
          invalidates: "xpChanged",
          onSuccess: (r) => setData((current) => (current ? { ...current, xpTotal: r.xpTotal, geneesBalance: r.geneesBalance, geneesPriceXp: r.nextPriceXp } : current)),
        }
      );
      setGeneesMessage({ type: "ok", text: t("shop.geneesBought", { n: result.geneesBalance }) });
      announceXpChanged();
    } catch (error) {
      setGeneesMessage({ type: "error", text: error instanceof Error && !error.message.startsWith("HTTP ") ? error.message : t("shop.buyFailed") });
    } finally {
      setBuyingGenees(false);
    }
  }

  async function buyHints() {
    if (!data) return;
    setBuyingHints(true);
    setHintMessage(null);
    const res = await fetch("/api/shop/hints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: hintQuantity }),
    });
    const body = await res.json().catch(() => ({}));
    setBuyingHints(false);
    if (!res.ok) {
      setHintMessage({ type: "error", text: body.error ?? t("shop.buyFailed") });
      return;
    }
    setData({ ...data, xpTotal: body.xpTotal, hintBalance: body.hintBalance });
    setHintMessage({ type: "ok", text: hintQuantity > 1 ? t("shop.hintsBought", { n: hintQuantity }) : t("shop.hintBought", { n: hintQuantity }) });
    announceXpChanged();
  }

  async function buyFreezes() {
    if (!data) return;
    setBuyingFreezes(true);
    setFreezeMessage(null);
    const res = await fetch("/api/shop/freezes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: freezeQuantity }),
    });
    const body = await res.json().catch(() => ({}));
    setBuyingFreezes(false);
    if (!res.ok) {
      setFreezeMessage({ type: "error", text: body.error ?? t("shop.buyFailed") });
      return;
    }
    setData({ ...data, xpTotal: body.xpTotal, freezeCount: body.freezeCount });
    setFreezeMessage({ type: "ok", text: freezeQuantity > 1 ? t("shop.freezesBought", { n: freezeQuantity }) : t("shop.freezeBought", { n: freezeQuantity }) });
    announceXpChanged();
  }

  if (!data) return <p className="text-slate-400 dark:text-slate-500 text-center">{t("common.loading")}</p>;

  const hintCost = hintQuantity * data.hintPriceXp;
  const canAffordHints = data.xpTotal >= hintCost;
  const freezeCost = freezeQuantity * data.freezePriceXp;
  const canAffordFreezes = data.xpTotal >= freezeCost;
  const canAffordGenees = data.xpTotal >= data.geneesPriceXp;

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <div className="card bg-gradient-to-br from-brand-500 to-brand-700 dark:from-brand-600 dark:to-brand-900 text-white flex flex-col items-center gap-1 !py-8">
        <SystemIcon kind="xp" className="h-10 w-10 text-gold-400" fill="currentColor" aria-hidden />
        <div className="text-4xl font-extrabold leading-none">{data.xpTotal}</div>
        <div className="text-brand-100 font-bold text-sm mt-1">{t("shop.xpAvailable")}</div>
      </div>

      {/* Een aankoop telt ook in de wekelijkse competitie (zie src/lib/shop.ts):
          dat moet vóór de aankoop duidelijk zijn, niet pas als je gedegradeerd bent. */}
      <div className="card !py-4 flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-300">
        <h2 className="font-extrabold text-slate-800 dark:text-slate-100">{t("shop.goodToKnow")}</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>{t("shop.note1")}</li>
          <li>{t("shop.note2")}</li>
          <li>{t("shop.note3")}</li>
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="card !py-3 !px-5 !bg-brand-50 dark:!bg-slate-800 !border-brand-100 dark:!border-slate-700">
          <div className="text-xl font-extrabold text-brand-600 dark:text-brand-300">💡 {data.hintBalance}</div>
          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("shop.hints")}</div>
        </div>
        <div className="card !py-3 !px-5 !bg-ice-50 dark:!bg-slate-800 !border-ice-400/30 dark:!border-slate-700">
          <div className="flex items-center gap-1 text-xl font-extrabold text-ice-600 dark:text-ice-400"><SystemIcon kind="freeze" className="h-5 w-5" aria-hidden />{data.freezeCount}</div>
          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("lesson.freezes")}</div>
        </div>
        <div className="card !py-3 !px-5 !bg-gold-50 dark:!bg-slate-800 !border-gold-400/30 dark:!border-slate-700">
          <div className="text-xl font-extrabold text-gold-600 dark:text-gold-400" data-genees-stock>{data.geneesBalance}</div>
          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("shop.geneesStockLabel")}</div>
        </div>
      </div>

      <div className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-lg dark:text-slate-100">{t("shop.hintTitle")}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("shop.hintText")}
            </p>
          </div>
          <span className="text-sm font-extrabold text-gold-600 dark:text-gold-400 whitespace-nowrap bg-gold-50 dark:bg-slate-700 rounded-full px-3 py-1">
            {data.hintPriceXp} XP
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex max-w-full flex-wrap items-center gap-2 text-sm dark:text-slate-200">
            {t("shop.quantity")}
            <AppSelect
              className="input !w-20 text-center"
              value={String(hintQuantity)}
              options={Array.from({ length: 10 }, (_, i) => i + 1).map((n) => ({ value: String(n), label: n }))}
              onChange={(value) => setHintQuantity(Number(value))}
              ariaLabel={t("shop.quantity")}
            />
          </label>
          <button className="btn-primary !px-4 !py-2" disabled={buyingHints || !canAffordHints} onClick={buyHints}>
            {buyingHints ? t("courses.busy") : t("shop.buyFor", { xp: hintCost })}
          </button>
        </div>
        {!canAffordHints && <p className="text-xs text-red-500 dark:text-red-400">{t("shop.notEnough")}</p>}
        {hintMessage && (
          <p
            className={`text-sm font-semibold ${
              hintMessage.type === "ok" ? "text-brand-600 dark:text-brand-300" : "text-red-600 dark:text-red-400"
            }`}
          >
            {hintMessage.text}
          </p>
        )}
      </div>

      <div className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-extrabold text-lg dark:text-slate-100">
              <SystemIcon kind="freeze" className="h-6 w-6" />
              {t("shop.freezeTitle")}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("shop.freezeText")}
            </p>
          </div>
          <span className="text-sm font-extrabold text-gold-600 dark:text-gold-400 whitespace-nowrap bg-gold-50 dark:bg-slate-700 rounded-full px-3 py-1">
            {data.freezePriceXp} XP
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex max-w-full flex-wrap items-center gap-2 text-sm dark:text-slate-200">
            {t("shop.quantity")}
            <AppSelect
              className="input !w-20 text-center"
              value={String(freezeQuantity)}
              options={Array.from({ length: 10 }, (_, i) => i + 1).map((n) => ({ value: String(n), label: n }))}
              onChange={(value) => setFreezeQuantity(Number(value))}
              ariaLabel={t("shop.quantity")}
            />
          </label>
          <button
            className="btn-primary !px-4 !py-2"
            disabled={buyingFreezes || !canAffordFreezes}
            onClick={buyFreezes}
          >
            {buyingFreezes ? t("courses.busy") : t("shop.buyFor", { xp: freezeCost })}
          </button>
        </div>
        {!canAffordFreezes && <p className="text-xs text-red-500 dark:text-red-400">{t("shop.notEnough")}</p>}
        {freezeMessage && (
          <p
            className={`text-sm font-semibold ${
              freezeMessage.type === "ok" ? "text-brand-600 dark:text-brand-300" : "text-red-600 dark:text-red-400"
            }`}
          >
            {freezeMessage.text}
          </p>
        )}
      </div>

      <div className="card flex flex-col gap-3" data-shop-genees>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-lg dark:text-slate-100">{t("shop.geneesTitle")}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("shop.geneesText")}</p>
            <p className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t("shop.geneesStock", { n: data.geneesBalance })}</p>
          </div>
          <span className="text-sm font-extrabold text-gold-600 dark:text-gold-400 whitespace-nowrap bg-gold-50 dark:bg-slate-700 rounded-full px-3 py-1" data-genees-price>
            {data.geneesPriceXp} XP
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("shop.geneesPriceRule")}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn-primary !px-4 !py-2" disabled={buyingGenees || !canAffordGenees} onClick={buyGenees}>
            {buyingGenees ? t("courses.busy") : t("shop.buyFor", { xp: data.geneesPriceXp })}
          </button>
        </div>
        {!canAffordGenees && <p className="text-xs text-red-500 dark:text-red-400">{t("shop.notEnough")}</p>}
        {geneesMessage && (
          <p className={`text-sm font-semibold ${geneesMessage.type === "ok" ? "text-brand-600 dark:text-brand-300" : "text-red-600 dark:text-red-400"}`}>{geneesMessage.text}</p>
        )}
      </div>
    </div>
  );
}
