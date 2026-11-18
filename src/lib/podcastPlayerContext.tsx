"use client";
import {applicationFetch} from "@/lib/data/applicationRuntime";


import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { chapterIndexAt, type PodcastChapter } from "@/lib/podcastChapters";

export interface PodcastEpisodeInfo {
  id: string;
  number: number;
  title: string;
  audioUrl: string;
  podcastName: string;
  /** Hoofdstukken uit de feed (oplopend); leeg als de aflevering er geen heeft. */
  chapters?: PodcastChapter[];
  /** Opgeslagen luisterpositie, als de pagina die al kent (zie playEpisode). */
  startAt?: number;
}

interface PodcastPlayerContextValue {
  episode: PodcastEpisodeInfo | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isSuppressed: boolean;
  playEpisode: (episode: PodcastEpisodeInfo) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  /** Index van het huidige hoofdstuk, of -1 (geen hoofdstukken of vóór het eerste). */
  chapterIndex: number;
  previousChapter: () => void;
  nextChapter: () => void;
  close: () => void;
}

const PodcastPlayerContext = createContext<PodcastPlayerContextValue | null>(null);

export function usePodcastPlayer(): PodcastPlayerContextValue {
  const ctx = useContext(PodcastPlayerContext);
  if (!ctx) throw new Error("usePodcastPlayer moet binnen PodcastPlayerProvider gebruikt worden.");
  return ctx;
}

// Hoe vaak de afspeelpositie tijdens het afspelen naar de server gaat.
const SAVE_INTERVAL_MS = 10_000;
// Vanaf hier telt een aflevering als "afgeluisterd".
const FINISHED_REMAINING_SECONDS = 15;

const DISMISSED_KEY = "podcast-dismissed-episode-id";

function getDismissedEpisodeId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function setDismissedEpisodeId(id: string | null) {
  try {
    if (id) localStorage.setItem(DISMISSED_KEY, id);
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Privé-modus/geblokkeerde storage: de speler blijft gewoon werken.
  }
}

export function PodcastPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [episode, setEpisode] = useState<PodcastEpisodeInfo | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [suppressedByOtherPlayer, setSuppressedByOtherPlayer] = useState(false);

  const loadedEpisodeIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const saveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const savePosition = useCallback((ep: PodcastEpisodeInfo, position: number, dur: number, keepalive = false) => {
    if (dur > 0 && dur - position <= FINISHED_REMAINING_SECONDS) {
      applicationFetch(`/api/podcast-playback?episodeId=${ep.id}`, { method: "DELETE", keepalive }).catch(() => {});
      return;
    }
    applicationFetch("/api/podcast-playback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodeId: ep.id, positionSeconds: position }),
      keepalive,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const stopPodcast = () => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.pause();
      setIsPlaying(false);
      setSuppressedByOtherPlayer(true);
    };
    window.addEventListener("jehovaapp:stop-podcast", stopPodcast);
    return () => window.removeEventListener("jehovaapp:stop-podcast", stopPodcast);
  }, []);

  useEffect(() => {
    const stopReadAloud = () => window.dispatchEvent(new Event("jehovaapp:stop-read-aloud"));
    window.addEventListener("jehovaapp:podcast-started", stopReadAloud);
    return () => window.removeEventListener("jehovaapp:podcast-started", stopReadAloud);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !episode || loadedEpisodeIdRef.current === episode.id) return;
    loadedEpisodeIdRef.current = episode.id;
    audio.src = episode.audioUrl;
    audio.load();
  }, [episode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function onLoadedMetadata() {
      setDuration(audio!.duration || 0);
      if (pendingSeekRef.current !== null) {
        audio!.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    }
    function onTimeUpdate() {
      setCurrentTime(audio!.currentTime);
    }
    function onPlay() {
      setIsPlaying(true);
    }
    function onPause() {
      setIsPlaying(false);
    }
    function onEnded() {
      setIsPlaying(false);
      if (episode) applicationFetch(`/api/podcast-playback?episodeId=${episode.id}`, { method: "DELETE" }).catch(() => {});
    }

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [episode]);

  useEffect(() => {
    if (!isPlaying || !episode) return;
    saveIntervalRef.current = setInterval(() => {
      const audio = audioRef.current;
      if (audio) savePosition(episode, audio.currentTime, audio.duration || 0);
    }, SAVE_INTERVAL_MS);
    return () => {
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
    };
  }, [isPlaying, episode, savePosition]);

  useEffect(() => {
    if (!episode) return;
    function saveNow(keepalive: boolean) {
      const audio = audioRef.current;
      if (audio && audio.currentTime > 0) savePosition(episode!, audio.currentTime, audio.duration || 0, keepalive);
    }
    if (!isPlaying) saveNow(false);
    const onLeave = () => saveNow(true);
    document.addEventListener("visibilitychange", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onLeave);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [isPlaying, episode, savePosition]);

  const playEpisode = useCallback((newEpisode: PodcastEpisodeInfo) => {
    const audio = audioRef.current;
    if (!audio) return;

    window.dispatchEvent(new Event("jehovaapp:podcast-started"));
    setSuppressedByOtherPlayer(false);
    setDismissedEpisodeId(null);

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `Aflevering ${newEpisode.number} — ${newEpisode.title}`,
        artist: newEpisode.podcastName,
      });
    }

    if (loadedEpisodeIdRef.current === newEpisode.id) {
      audio.play().catch(() => {});
      return;
    }

    // Bron zetten en play() aanroepen gebeurt bewust nog binnen de klik:
    // Safari en iOS staan afspelen alleen toe als direct gevolg van een
    // tik. Eerst de opgeslagen positie ophalen en pas daarna play() liet de
    // eerste klik daar stilletjes niets doen. De positie wordt toegepast
    // zodra de metadata binnen is (onLoadedMetadata), vóór er geluid klinkt.
    loadedEpisodeIdRef.current = newEpisode.id;
    pendingSeekRef.current = newEpisode.startAt ?? null;
    setDuration(0);
    setCurrentTime(newEpisode.startAt ?? 0);
    setEpisode(newEpisode);
    audio.src = newEpisode.audioUrl;
    audio.play().catch(() => {});

    // Zonder bekende positie (bv. vanaf een andere pagina) alsnog ophalen;
    // dan springt de speler er heen zodra het antwoord er is.
    if (newEpisode.startAt === undefined) {
      applicationFetch(`/api/podcast-playback?episodeId=${newEpisode.id}`)
        .then((r) => r.json())
        .then((data) => {
          const position = Number(data.positionSeconds) || 0;
          if (position <= 0 || loadedEpisodeIdRef.current !== newEpisode.id) return;
          if (audio.readyState >= 1) audio.currentTime = position;
          else pendingSeekRef.current = position;
          setCurrentTime(position);
        })
        .catch(() => {});
    }
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !episode) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, [episode]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
  }, []);

  const chapters = episode?.chapters ?? [];
  const chapterIndex = chapterIndexAt(chapters, currentTime);

  // Zoals bij een cd-speler: eerst terug naar het begin van het huidige
  // hoofdstuk, pas binnen de eerste seconden ervan naar het vorige.
  const previousChapter = useCallback(() => {
    const audio = audioRef.current;
    const list = episode?.chapters ?? [];
    if (!audio || list.length === 0) return;
    const index = chapterIndexAt(list, audio.currentTime);
    const target = index >= 0 && audio.currentTime - list[index].start > 3 ? index : index - 1;
    audio.currentTime = target >= 0 ? list[target].start : 0;
    setCurrentTime(audio.currentTime);
  }, [episode]);

  const nextChapter = useCallback(() => {
    const audio = audioRef.current;
    const list = episode?.chapters ?? [];
    if (!audio || list.length === 0) return;
    const next = list[chapterIndexAt(list, audio.currentTime) + 1];
    if (!next) return;
    audio.currentTime = next.start;
    setCurrentTime(next.start);
  }, [episode]);

  // Vorige/volgende op het vergrendelscherm en koptelefoon springen per
  // hoofdstuk, net als de knoppen in de minispeler.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const hasChapters = (episode?.chapters?.length ?? 0) >= 2;
    try {
      navigator.mediaSession.setActionHandler("previoustrack", hasChapters ? previousChapter : null);
      navigator.mediaSession.setActionHandler("nexttrack", hasChapters ? nextChapter : null);
    } catch {
      // Niet elke browser kent deze acties.
    }
  }, [episode, previousChapter, nextChapter]);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      if (episode && audio.currentTime > 0) savePosition(episode, audio.currentTime, audio.duration || 0);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (episode) setDismissedEpisodeId(episode.id);
    loadedEpisodeIdRef.current = null;
    setEpisode(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setSuppressedByOtherPlayer(false);
  }, [episode, savePosition]);

  return (
    <PodcastPlayerContext.Provider value={{ episode, isPlaying, currentTime, duration, isSuppressed: suppressedByOtherPlayer, playEpisode, togglePlay, seek, chapterIndex, previousChapter, nextChapter, close }}>
      {children}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} className="hidden" />
    </PodcastPlayerContext.Provider>
  );
}
