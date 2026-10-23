"use client";
import { useState } from "react";
import { ExternalLink, VideoOff } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { focusRing } from "@/components/versado/styles";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";

type Block = ReaderDocument["sections"][number]["blocks"][number];

/**
 * Een officiële CFM-video rechtstreeks in de les: een gewone HTML5-speler op een officieel MP4-bestand (de bron biedt geen
 * insluitbare iframe; de URL's zijn bij het importeren op een exacte hostlijst gecontroleerd, zie schema.ts). Nooit automatisch
 * afspelen (`preload="none"`, het afspelen start alleen met een tik), 16:9-vlak dat vóór het laden de juiste hoogte heeft, systeembediening
 * (toetsenbord, schermlezer, volledig scherm; `playsInline` houdt iOS in de pagina tot de gebruiker zelf vergroot) en een
 * duidelijke terugval met de officiële link als afspelen niet lukt. De poster is de bijbehorende, gebonden afbeelding.
 */
export default function StudyVideo({ block, poster }: { block: Extract<Block, { type: "video" }>; poster: string | null }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const first = block.sources[0];
  const last = block.sources.length - 1;
  return (
    <figure data-study-video={block.id} className="min-w-0">
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${first.width} / ${first.height}` }}>
        {failed ? (
          <div role="alert" className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
            <VideoOff aria-hidden size={28} />
            <p>{t("studyVideo.failed")}</p>
          </div>
        ) : (
          <video
            controls
            preload="none"
            playsInline
            poster={poster ?? undefined}
            aria-label={block.title}
            className="h-full w-full"
            onError={() => setFailed(true)}
          >
            {block.sources.map((source, index) => (
              // Een mislukte laatste bron (alle bronnen geprobeerd) is de foutstatus; de browser kiest zelf de eerste speelbare.
              <source key={source.url} src={source.url} type="video/mp4" onError={index === last ? () => setFailed(true) : undefined} />
            ))}
          </video>
        )}
      </div>
      <figcaption className="mx-auto mt-2 max-w-3xl text-sm text-vs-fg-2">
        <span data-study-text={block.id} className="font-semibold text-vs-fg">{block.title}</span>
        {block.description ? <span className="block">{block.description}</span> : null}
        <a
          href={block.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-1 inline-flex min-h-11 items-center gap-1.5 text-vs-accent underline underline-offset-2 ${focusRing}`}
        >
          <ExternalLink aria-hidden size={14} />
          {t("studyVideo.openOfficial")}
        </a>
      </figcaption>
    </figure>
  );
}
