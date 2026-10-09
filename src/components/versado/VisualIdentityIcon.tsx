"use client";

import Image from "next/image";
import { createElement, useState } from "react";
import { visualIdentityAsset, type VisualIdentityAssetId } from "@/lib/visualIdentityAssets";

/**
 * Decoratief V2-beeld met eenmalige lijnicoonfallback. De zichtbare tekst
 * naast het beeld draagt de betekenis; een gebroken WebP mag die nooit
 * vervangen door een leeg vlak.
 */
export default function VisualIdentityIcon({
  asset,
  className = "",
  sizes = "48px",
}: {
  asset: VisualIdentityAssetId;
  className?: string;
  sizes?: string;
}) {
  const definition = visualIdentityAsset(asset);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return createElement(definition.fallback, { className, "aria-hidden": true });
  }

  return (
    <Image
      src={definition.src}
      alt=""
      aria-hidden
      width={256}
      height={256}
      sizes={sizes}
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
