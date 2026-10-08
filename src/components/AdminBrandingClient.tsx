"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { TFunction } from "@/lib/i18n/core";
import AdminSection from "@/components/admin/AdminSection";
import { secondaryButton } from "@/components/versado/styles";

interface BrandingView {
  logoDataUrl: string | null;
  faviconDataUrl: string | null;
  appName: string | null;
}

// PNG (niet JPEG) om transparantie in een logo/favicon te behouden.
function resizeToDataUrl(t: TFunction, file: File, maxDimension: number, minDimension?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("adminBranding.readFailed")));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error(t("adminBranding.invalidImage")));
      img.onload = () => {
        let { width, height } = img;
        // Kleiner dan het minimum weigeren i.p.v. uitrekken: een favicon
        // dient ook als linkpreview-afbeelding (zie openGraph.images in
        // layout.tsx), en een piepklein bronbestand zou daar wazig/opgerekt
        // uitkomen — beter vooraf een duidelijke melding dan achteraf een
        // matige preview in WhatsApp e.d.
        if (minDimension && (width < minDimension || height < minDimension)) {
          reject(new Error(t("adminBranding.tooSmall", { w: width, h: height, min: minDimension })));
          return;
        }
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function ImageSlot({
  label,
  description,
  value,
  maxDimension,
  minDimension,
  previewClassName,
  onChange,
}: {
  label: string;
  description: string;
  value: string | null;
  maxDimension: number;
  minDimension?: number;
  previewClassName: string;
  onChange: (dataUrl: string | null) => Promise<void>;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // file.type is bij .ico-bestanden vaak een lege string (browsers/OS'en
    // registreren dat mimetype niet altijd), dus val bij twijfel terug op de
    // bestandsextensie in plaats van de upload stilzwijgend te negeren.
    const looksLikeImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|svg|ico)$/i.test(file.name);
    if (!looksLikeImage) {
      setError(t("adminBranding.chooseImage"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await resizeToDataUrl(t, file, maxDimension, minDimension);
      await onChange(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("adminBranding.processFailed"));
    }
    setBusy(false);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    await onChange(null);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-bold text-sm text-vs-fg">{label}</p>
      <p className="text-xs text-vs-fg-2">{description}</p>
      <div className="flex items-center gap-3">
        <div className={`flex items-center justify-center bg-vs-subtle rounded-lg border border-vs-line ${previewClassName}`}>
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-vs-fg-3">{t("adminBranding.none")}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
          <button className={`${secondaryButton} self-start`} disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? t("adminCommon.busy") : value ? t("adminBranding.replace") : t("adminBranding.upload")}
          </button>
          {value && (
            <button className="text-xs text-vs-danger hover:underline self-start" disabled={busy} onClick={remove}>
              {t("adminCommon.delete")}
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-xs text-vs-danger">{error}</p>}
    </div>
  );
}

export default function AdminBrandingClient() {
  const t = useT();
  const [branding, setBranding] = useState<BrandingView | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [appNameInput, setAppNameInput] = useState("");

  useEffect(() => {
    fetch("/api/admin/branding")
      .then((r) => r.json())
      .then((b: BrandingView) => {
        setBranding(b);
        setAppNameInput(b.appName ?? "");
      });
  }, []);

  async function save(patch: Partial<BrandingView>) {
    setSavedMessage(null);
    const res = await fetch("/api/admin/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setBranding(await res.json());
      setSavedMessage(t("adminBranding.savedRefresh"));
    }
  }

  if (!branding) return <p className="text-vs-fg-3">{t("common.loading")}</p>;

  return (
    <AdminSection title={t("adminBranding.title")}>

      <p className="text-sm text-vs-fg-2">
        {t("adminBranding.intro")}
      </p>

      <div className="flex flex-col gap-2">
        <p className="font-bold text-sm text-vs-fg">{t("adminBranding.appName")}</p>
        <p className="text-xs text-vs-fg-2">
          {t("adminBranding.appNameText")}
        </p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ appName: appNameInput || null });
          }}
        >
          <input
            type="text"
            className="input !py-2 max-w-xs"
            maxLength={40}
            placeholder="Versado"
            value={appNameInput}
            onChange={(e) => setAppNameInput(e.target.value)}
          />
          <button type="submit" className={secondaryButton}>
            {t("adminCommon.save")}
          </button>
        </form>
      </div>

      <ImageSlot
        label={t("adminBranding.logoHeader")}
        description={t("adminBranding.logoHeaderText")}
        value={branding.logoDataUrl}
        maxDimension={512}
        previewClassName="h-12 w-32 px-2"
        onChange={(logoDataUrl) => save({ logoDataUrl })}
      />

      <ImageSlot
        label={t("adminBranding.favicon")}
        description={t("adminBranding.faviconText")}
        value={branding.faviconDataUrl}
        maxDimension={256}
        minDimension={200}
        previewClassName="h-12 w-12"
        onChange={(faviconDataUrl) => save({ faviconDataUrl })}
      />

      {savedMessage && <p className="text-sm font-semibold text-vs-accent">{savedMessage}</p>}
    </AdminSection>
  );
}
