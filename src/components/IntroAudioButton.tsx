"use client";
import {useGameMedia} from "@/components/games/GameMediaContext";
import type {NativeGameAudioInput} from "@/lib/native/gamesAudioContract";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";

interface IntroAudio {
  url: string;
  start: number;
  end: number;
}

/**
 * Speelt bij "Raad het hoofdstuk" alleen de voorgelezen hoofdstukkop af: een
 * stuk uit de audio van het hele hoofdstuk (zie Chapter.audioHeadingStart).
 * Stopt vanzelf aan het eind van de kop, en bij een volgende vraag.
 */
type Props={audio:IntroAudio|null|undefined;nativeTarget?:Exclude<NativeGameAudioInput,{kind:"reading"}>;text?:string};
export default function IntroAudioButton(props:Props){
 const media=useGameMedia();if(media){const Intro=media.Intro;return <Intro {...props}/>;}
 return <WebIntroAudioButton audio={props.audio}/>;
}
function WebIntroAudioButton({audio}:Props){
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  // Nieuwe vraag (ander fragment) of weg van het scherm: stoppen.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      setPlaying(false);
      setLoading(false);
    };
  }, [audio?.url, audio?.start]);

  if (!audio) return null;
  const clip = audio;

  function stop() {
    audioRef.current?.pause();
    setPlaying(false);
    setLoading(false);
  }

  function play() {
    // Voorlezen en de podcast delen één audio-uitvoer (zie podcastPlayerContext).
    window.dispatchEvent(new Event("jehovaapp:stop-podcast"));
    window.dispatchEvent(new Event("jehovaapp:stop-read-aloud"));
    let el = audioRef.current;
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    const player = el;
    const begin = () => {
      player.currentTime = clip.start;
      player.play().then(
        () => {
          setLoading(false);
          setPlaying(true);
        },
        () => stop()
      );
    };
    player.ontimeupdate = () => {
      if (player.currentTime >= clip.end) stop();
    };
    player.onended = () => stop();
    player.onerror = () => stop();
    setLoading(true);
    if (player.src !== clip.url) {
      player.src = clip.url;
      // De starttijd kan pas gezet worden als de browser de duur kent.
      player.onloadedmetadata = () => {
        player.onloadedmetadata = null;
        begin();
      };
      player.load();
    } else {
      begin();
    }
  }

  return (
    <button
      type="button"
      onClick={playing || loading ? stop : play}
      className="btn-secondary !px-4 !py-2 self-start inline-flex items-center gap-2"
    >
      <span aria-hidden>{playing ? "⏸" : loading ? "⏳" : "🔊"}</span>
      {playing ? t("chapterGuess.stopAudio") : loading ? t("common.loading") : t("chapterGuess.listenIntro")}
    </button>
  );
}
