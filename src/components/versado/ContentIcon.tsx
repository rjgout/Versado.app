"use client";

import Image from "next/image";
import { createElement, useState } from "react";
import { contentIcon, contentIconSources } from "@/lib/contentMetadata";

type ContentIdentity = { id: string; work: string | null };

/**
 * Het icoon van een contentbron, uit src/lib/contentMetadata.ts.
 *
 * De naam staat al als echte UI-tekst naast dit decoratieve beeld. Bij een
 * ontbrekend asset proberen we eerst de generieke bronafbeelding en daarna het
 * bestaande functionele Lucidefallbackicoon, zodat één fout bestand de
 * contentkiezer niet onbruikbaar maakt.
 */
export default function ContentIcon({ collection, className, size = 28 }: { collection: ContentIdentity; className: string; size?: number }) {
  const sources = contentIconSources(collection);
  const sourceKey = sources.join("|");
  const [failure, setFailure] = useState<{ sourceKey: string; sourceIndex: number }>({ sourceKey: "", sourceIndex: 0 });
  const activeIndex = failure.sourceKey === sourceKey ? failure.sourceIndex : 0;
  const src = sources[activeIndex] ?? null;

  if (!src) return createElement(contentIcon(collection), { className, "aria-hidden": true });

  return (
    <Image
      key={src}
      src={src}
      alt=""
      aria-hidden
      width={size}
      height={size}
      sizes={`${size}px`}
      className={`object-contain ${className}`}
      onError={() => {
        setFailure((previous) => ({
          sourceKey,
          sourceIndex: Math.min(previous.sourceKey === sourceKey ? previous.sourceIndex + 1 : 1, sources.length),
        }));
      }}
    />
  );
}
