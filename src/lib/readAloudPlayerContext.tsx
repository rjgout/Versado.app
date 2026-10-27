"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getDutchVoices, getSelectedDutchVoice } from "@/lib/readAloud";
import { beginSpeechPlayback, endSpeechPlayback } from "@/lib/speechAudioSession";
import { getLanguage } from "@/lib/languages";

export interface ReadAloudVerse {
  number: number;
  text: string;
  /** Begin van dit vers in `audio.url`, in seconden (zie Verse.audioStart). */
  audioStart?: number | null;
}

export interface ReadAloudSource {
  id: string;
  title: string;
  verses: ReadAloudVerse[];
  /**
   * Voorgelezen audio van het hoofdstuk. `end` is waar het laatste vers van
   * deze bron ophoudt (het begin van het vers erna), of null om tot het eind
   * van het bestand door te spelen.
   */
  audio?: { url: string; end: number | null; fallback?: { url:string; end:number|null; verses:ReadAloudVerse[] } | null } | null;
  /** Taal van de tekst (src/lib/languages.ts); bepaalt de computerstem. Zonder: Nederlands. */
  language?: string;
}

// Echte audio alleen als élk vers een begintijd heeft; anders de computerstem,
// zodat vorige/volgende vers altijd blijft kloppen.
function hasRecordedAudio(source: ReadAloudSource | null): boolean {
  return !!source?.audio && source.verses.every((v) => v.audioStart != null);
}

interface ReadAloudPlayerContextValue {
  source: ReadAloudSource | null;
  isPlaying: boolean;
  currentIndex: number;
  speed: number;
  start: (source: ReadAloudSource, index?: number) => void;
  togglePlay: () => void;
  previousVerse: () => void;
  nextVerse: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
}

const ReadAloudPlayerContext = createContext<ReadAloudPlayerContextValue | null>(null);
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function useReadAloudPlayer(): ReadAloudPlayerContextValue {
  const ctx = useContext(ReadAloudPlayerContext);
  if (!ctx) throw new Error("useReadAloudPlayer moet binnen ReadAloudPlayerProvider gebruikt worden.");
  return ctx;
}

/** Computerstem voor een taal; bij Nederlands de stem die in het profiel gekozen is. */
export function getVoice(language?: string): SpeechSynthesisVoice | null {
  const { code, intlLocale } = getLanguage(language);
  if (code !== "nl") {
    // Andere talen: de stemkeuze in het profiel geldt alleen voor Nederlands.
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => voice.lang.toLowerCase() === intlLocale.toLowerCase())
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(`${code}-`))
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(code))
      ?? null;
  }
  const voices = getDutchVoices();
  return getSelectedDutchVoice() ?? voices.find((voice) => voice.lang.toLowerCase() === "nl-nl")
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("nl-"))
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("nl"))
    ?? null;
}

export function ReadAloudPlayerProvider({ children }: { children: React.ReactNode }) {
  const [source, setSource] = useState<ReadAloudSource | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const sourceRef = useRef<ReadAloudSource | null>(null);
  const currentIndexRef = useRef(0);
  const playingRef = useRef(false);
  const utteranceIdRef = useRef(0);
  const speedRef = useRef(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const saved = window.localStorage.getItem("jehovaapp-read-aloud-speed");
    const parsed = Number(saved);
    if (SPEEDS.includes(parsed)) {
      speedRef.current = parsed;
      setSpeedState(parsed);
    }
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    const onVoicesChanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onVoicesChanged);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", onVoicesChanged);
  }, []);

  const finishAudio = useCallback(() => {
    audioRef.current?.pause();
    playingRef.current = false;
    setIsPlaying(false);
    currentIndexRef.current = 0;
    setCurrentIndex(0);
  }, []);

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const el = new Audio();
    el.preload = "auto";
    el.ontimeupdate = () => {
      const current = sourceRef.current;
      if (!playingRef.current || !current?.audio) return;
      const t = el.currentTime;
      if (current.audio.end != null && t >= current.audio.end - 0.05) {
        finishAudio();
        return;
      }
      let index = 0;
      current.verses.forEach((v, i) => {
        if ((v.audioStart ?? 0) <= t + 0.1) index = i;
      });
      if (index !== currentIndexRef.current) {
        currentIndexRef.current = index;
        setCurrentIndex(index);
      }
    };
    el.onended = () => finishAudio();
    el.onerror = () => {
      const current=sourceRef.current, fallback=current?.audio?.fallback;
      if(playingRef.current&&current&&fallback&&fallback.verses.length===current.verses.length&&fallback.verses.every(v=>v.audioStart!=null)) {
        // Alleen door de server gecontroleerde legacy-uitgangssituatie; één poging, met eigen versgrenzen.
        const restored={...current,verses:fallback.verses,audio:{url:fallback.url,end:fallback.end}};
        sourceRef.current=restored;setSource(restored);
        el.onloadedmetadata=()=>{el.onloadedmetadata=null;if(sourceRef.current!==restored||!playingRef.current)return;el.playbackRate=speedRef.current;el.currentTime=restored.verses[currentIndexRef.current]?.audioStart??0;void el.play().catch(finishAudio);};
        el.src=fallback.url;el.load();
        return;
      }
      finishAudio();
    };
    audioRef.current = el;
    return el;
  }, [finishAudio]);

  const playAudioFrom = useCallback((index: number) => {
    const current = sourceRef.current;
    if (!current?.audio) return;
    const el = ensureAudio();
    const startAt = current.verses[index]?.audioStart ?? 0;
    const go = () => {
      el.playbackRate = speedRef.current;
      el.currentTime = startAt;
      el.play().catch(() => {
        playingRef.current = false;
        setIsPlaying(false);
      });
    };
    if (el.src !== current.audio.url) {
      el.src = current.audio.url;
      // De starttijd kan pas gezet worden als de browser de duur kent.
      el.onloadedmetadata = () => {
        el.onloadedmetadata = null;
        go();
      };
      el.load();
    } else {
      go();
    }
  }, [ensureAudio]);

  const speakFrom = useCallback((index: number) => {
    const currentSource = sourceRef.current;
    if (!currentSource || !("speechSynthesis" in window) || index < 0 || index >= currentSource.verses.length) return;

    const synth = window.speechSynthesis;
    const utteranceId = ++utteranceIdRef.current;
    const voice = getVoice(currentSource.language);

    for (let verseIndex = index; verseIndex < currentSource.verses.length; verseIndex += 1) {
      const utterance = new SpeechSynthesisUtterance(currentSource.verses[verseIndex].text);
      utterance.lang = getLanguage(currentSource.language).intlLocale;
      utterance.rate = speedRef.current;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      utterance.onstart = () => {
        if (!playingRef.current || utteranceId !== utteranceIdRef.current) return;
        currentIndexRef.current = verseIndex;
        setCurrentIndex(verseIndex);
      };
      utterance.onend = () => {
        if (!playingRef.current || utteranceId !== utteranceIdRef.current) return;
        if (verseIndex === currentSource.verses.length - 1) {
          endSpeechPlayback();
          playingRef.current = false;
          setIsPlaying(false);
          setCurrentIndex(0);
        }
      };
      utterance.onerror = () => {
        if (utteranceId !== utteranceIdRef.current) return;
        endSpeechPlayback();
        playingRef.current = false;
        setIsPlaying(false);
      };
      synth.speak(utterance);
    }
  }, []);

  const start = useCallback((newSource: ReadAloudSource, index = 0) => {
    const recorded = hasRecordedAudio(newSource);
    if ((!recorded && !("speechSynthesis" in window)) || newSource.verses.length === 0) return;
    // Voorlezen en de podcast delen één audio-uitvoer: een nieuwe voorleesactie
    // stopt de podcast direct, zodat nooit twee audiostreams tegelijk klinken.
    window.dispatchEvent(new Event("jehovaapp:stop-podcast"));
    utteranceIdRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    audioRef.current?.pause();
    // Echte audio speelt ook met de stille modus aan; alleen de computerstem
    // heeft de truc uit speechAudioSession.ts nodig.
    if (!recorded) beginSpeechPlayback();
    else endSpeechPlayback();
    sourceRef.current = newSource;
    setSource(newSource);
    currentIndexRef.current = index;
    setCurrentIndex(index);
    playingRef.current = true;
    setIsPlaying(true);
    if (recorded) playAudioFrom(index);
    else speakFrom(index);
  }, [speakFrom, playAudioFrom]);

  const togglePlay = useCallback(() => {
    const currentSource = sourceRef.current;
    if (hasRecordedAudio(currentSource)) {
      const el = audioRef.current;
      if (isPlaying) {
        el?.pause();
        playingRef.current = false;
        setIsPlaying(false);
        return;
      }
      playingRef.current = true;
      setIsPlaying(true);
      // Hervatten waar gepauzeerd; na afloop (index terug op 0) opnieuw vanaf het begin.
      const verseStart = currentSource!.verses[currentIndexRef.current]?.audioStart ?? 0;
      if (el && el.src === currentSource!.audio!.url && el.currentTime >= verseStart) {
        el.playbackRate = speedRef.current;
        el.play().catch(() => {
          playingRef.current = false;
          setIsPlaying(false);
        });
      } else {
        playAudioFrom(currentIndexRef.current);
      }
      return;
    }
    if (!currentSource || !("speechSynthesis" in window)) return;
    if (isPlaying) {
      playingRef.current = false;
      setIsPlaying(false);
      window.speechSynthesis.pause();
      endSpeechPlayback();
      return;
    }
    beginSpeechPlayback();
    playingRef.current = true;
    setIsPlaying(true);
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    else speakFrom(currentIndexRef.current);
  }, [isPlaying, speakFrom, playAudioFrom]);

  const jumpTo = useCallback((index: number) => {
    const currentSource = sourceRef.current;
    if (currentSource && hasRecordedAudio(currentSource)) {
      const clamped = Math.max(0, Math.min(index, currentSource.verses.length - 1));
      currentIndexRef.current = clamped;
      setCurrentIndex(clamped);
      if (playingRef.current) playAudioFrom(clamped);
      else if (audioRef.current) audioRef.current.currentTime = currentSource.verses[clamped].audioStart ?? 0;
      return;
    }
    if (!currentSource || !("speechSynthesis" in window)) return;
    const clamped = Math.max(0, Math.min(index, currentSource.verses.length - 1));
    const wasPlaying = playingRef.current;
    utteranceIdRef.current += 1;
    window.speechSynthesis.cancel();
    currentIndexRef.current = clamped;
    setCurrentIndex(clamped);
    if (wasPlaying) {
      playingRef.current = true;
      setIsPlaying(true);
      speakFrom(clamped);
    }
  }, [speakFrom, playAudioFrom]);

  const previousVerse = useCallback(() => jumpTo(currentIndexRef.current - 1), [jumpTo]);
  const nextVerse = useCallback(() => jumpTo(currentIndexRef.current + 1), [jumpTo]);

  const stop = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    audioRef.current?.pause();
    endSpeechPlayback();
    utteranceIdRef.current += 1;
    playingRef.current = false;
    setIsPlaying(false);
    sourceRef.current = null;
    setSource(null);
    setCurrentIndex(0);
  }, []);

  useEffect(() => {
    const stopForPodcast = () => {
      audioRef.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      endSpeechPlayback();
      utteranceIdRef.current += 1;
      playingRef.current = false;
      setIsPlaying(false);
      sourceRef.current = null;
      setSource(null);
      setCurrentIndex(0);
    };
    window.addEventListener("jehovaapp:stop-read-aloud", stopForPodcast);
    return () => window.removeEventListener("jehovaapp:stop-read-aloud", stopForPodcast);
  }, []);

  const setSpeed = useCallback((nextSpeed: number) => {
    if (!SPEEDS.includes(nextSpeed)) return;
    speedRef.current = nextSpeed;
    setSpeedState(nextSpeed);
    window.localStorage.setItem("jehovaapp-read-aloud-speed", String(nextSpeed));
    if (hasRecordedAudio(sourceRef.current)) {
      if (audioRef.current) audioRef.current.playbackRate = nextSpeed;
      return;
    }
    if (playingRef.current) {
      const index = currentIndexRef.current;
      utteranceIdRef.current += 1;
      window.speechSynthesis.cancel();
      playingRef.current = true;
      setIsPlaying(true);
      speakFrom(index);
    }
  }, [speakFrom]);

  useEffect(() => () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    audioRef.current?.pause();
    endSpeechPlayback();
  }, []);

  return (
    <ReadAloudPlayerContext.Provider value={{ source, isPlaying, currentIndex, speed, start, togglePlay, previousVerse, nextVerse, stop, setSpeed }}>
      {children}
    </ReadAloudPlayerContext.Provider>
  );
}
