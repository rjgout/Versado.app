import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@/generated/prisma/client";
import { syncPodcastFeed } from "@/lib/podcastFeed";
import { PODCASTS } from "@/lib/podcasts";
import { createPodcastFeedSyncTicker, PODCAST_FEED_SYNC_INTERVAL_MS } from "@/lib/scheduler";

type EpisodeKey = `${string}:${number}`;
interface StoredEpisode {
  id: string;
  podcastId: string;
  number: number;
  title: string;
  summary: string | null;
  listenUrl: string | null;
  audioUrl: string | null;
  transcriptUrl: string | null;
  publishedAt: Date | null;
  order: number;
  chaptersUrl: string | null;
  chapters: string | null;
}

type EpisodeData = Omit<StoredEpisode, "id" | "podcastId" | "number" | "chaptersUrl" | "chapters">;
type EpisodeWhere = { podcastId_number: { podcastId: string; number: number } };

function episodeKey(podcastId: string, number: number): EpisodeKey {
  return `${podcastId}:${number}`;
}

/** Kleine geheugen-dubbelganger: de feedsync mag nooit de oefeningentabel raken. */
function makePodcastDb() {
  const episodes = new Map<EpisodeKey, StoredEpisode>();
  let exerciseCalls = 0;
  const client = {
    podcast: {
      upsert: async () => undefined,
    },
    podcastEpisode: {
      findUnique: async ({ where }: { where: EpisodeWhere }) => {
        const row = episodes.get(episodeKey(where.podcastId_number.podcastId, where.podcastId_number.number));
        return row ? { id: row.id, chaptersUrl: row.chaptersUrl, chapters: row.chapters } : null;
      },
      upsert: async ({ where, update, create }: { where: EpisodeWhere; update: EpisodeData; create: EpisodeData & { podcastId: string; number: number } }) => {
        const key = episodeKey(where.podcastId_number.podcastId, where.podcastId_number.number);
        const current = episodes.get(key);
        const saved: StoredEpisode = current
          ? { ...current, ...update }
          : { id: `episode-${episodes.size + 1}`, ...create, chaptersUrl: null, chapters: null };
        episodes.set(key, saved);
        return { id: saved.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Pick<StoredEpisode, "chaptersUrl" | "chapters">> }) => {
        const entry = [...episodes.entries()].find(([, episode]) => episode.id === where.id);
        if (!entry) throw new Error("Aflevering ontbreekt");
        episodes.set(entry[0], { ...entry[1], ...data });
      },
    },
    podcastExercise: {
      create: async () => {
        exerciseCalls++;
        throw new Error("RSS-sync mag geen oefeningen aanmaken");
      },
    },
  };
  return { client: client as unknown as PrismaClient, episodes, exerciseCalls: () => exerciseCalls };
}

function xmlEpisode(number: string | null, title: string, summary = "Omschrijving", audioUrl = "https://audio.invalid/episode.mp3") {
  const numberTag = number === null ? "" : `<itunes:episode>${number}</itunes:episode>`;
  return `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><item><title>${title}</title>${numberTag}<link>https://listen.invalid/${title}</link><description>${summary}</description><pubDate>Mon, 01 Jan 2026 12:00:00 GMT</pubDate><enclosure url="${audioUrl}" type="audio/mpeg" /></item></channel></rss>`;
}

async function withFeedFetch(feeds: Map<string, string | Error>, work: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    const feed = feeds.get(url);
    if (feed instanceof Error) throw feed;
    if (typeof feed !== "string") throw new Error(`Onverwachte fetch naar ${url}`);
    return new Response(feed, { status: 200, headers: { "content-type": "application/rss+xml" } });
  }) as typeof fetch;
  try {
    await work();
  } finally {
    globalThis.fetch = previous;
  }
}

function feeds(first: string | Error, second: string | Error) {
  return new Map<string, string | Error>([
    [PODCASTS[0].feedUrl, first],
    [PODCASTS[1].feedUrl, second],
  ]);
}

test("RSS-sync maakt nieuwe afleveringen met metadata en zonder oefeningen", async () => {
  const db = makePodcastDb();
  await withFeedFetch(feeds(xmlEpisode("127", "127: Een nieuwe aflevering", "Nieuwe omschrijving", "https://audio.invalid/127.mp3"), xmlEpisode("8", "8: Andere podcast")), async () => {
    await syncPodcastFeed(db.client);
  });

  const episode = db.episodes.get(episodeKey(PODCASTS[0].id, 127));
  assert.deepEqual(episode && {
    title: episode.title,
    summary: episode.summary,
    audioUrl: episode.audioUrl,
    listenUrl: episode.listenUrl,
    order: episode.order,
  }, {
    title: "Een nieuwe aflevering",
    summary: "Nieuwe omschrijving",
    audioUrl: "https://audio.invalid/127.mp3",
    listenUrl: "https://listen.invalid/127: Een nieuwe aflevering",
    order: -127,
  });
  assert.equal(db.exerciseCalls(), 0);
});

test("RSS-sync werkt bestaande aflevering bij zonder een duplicaat of oefeningen", async () => {
  const db = makePodcastDb();
  await withFeedFetch(feeds(xmlEpisode("127", "127: Zelfde aflevering", "Eerste omschrijving"), xmlEpisode("8", "8: Andere podcast")), async () => {
    await syncPodcastFeed(db.client);
  });
  await withFeedFetch(feeds(xmlEpisode("127", "127: Zelfde aflevering", "Gecorrigeerde omschrijving", "https://audio.invalid/nieuwe-link.mp3"), xmlEpisode("8", "8: Andere podcast")), async () => {
    await syncPodcastFeed(db.client);
  });

  assert.equal(db.episodes.size, 2);
  assert.deepEqual(db.episodes.get(episodeKey(PODCASTS[0].id, 127)) && {
    summary: db.episodes.get(episodeKey(PODCASTS[0].id, 127))!.summary,
    audioUrl: db.episodes.get(episodeKey(PODCASTS[0].id, 127))!.audioUrl,
  }, {
    summary: "Gecorrigeerde omschrijving",
    audioUrl: "https://audio.invalid/nieuwe-link.mp3",
  });
  assert.equal(db.exerciseCalls(), 0);
});

test("RSS-sync meldt alleen werkelijk nieuwe afleveringen aan de schedulerlaag", async () => {
  const db = makePodcastDb();
  const created: { podcastId: string; number: number }[] = [];
  const options = { onEpisodeCreated: async (podcast: (typeof PODCASTS)[number], episode: { number: number }) => { created.push({ podcastId: podcast.id, number: episode.number }); } };
  await withFeedFetch(feeds(xmlEpisode("127", "127: Nieuwe aflevering"), xmlEpisode("8", "8: Andere podcast")), async () => {
    await syncPodcastFeed(db.client, console.log, options);
  });
  await withFeedFetch(feeds(xmlEpisode("127", "127: Nieuwe aflevering", "Bijgewerkte omschrijving"), xmlEpisode("8", "8: Andere podcast")), async () => {
    await syncPodcastFeed(db.client, console.log, options);
  });
  assert.deepEqual(created, [{ podcastId: PODCASTS[0].id, number: 127 }, { podcastId: PODCASTS[1].id, number: 8 }]);
  assert.equal(db.exerciseCalls(), 0);
});

test("RSS-sync slaat afleveringen zonder nummer over en laat een andere feed doorgaan", async () => {
  const db = makePodcastDb();
  const logs: string[] = [];
  await withFeedFetch(feeds(xmlEpisode(null, "Een aflevering zonder nummer"), xmlEpisode("9", "9: De tweede feed werkt")), async () => {
    await syncPodcastFeed(db.client, (message) => logs.push(message));
  });

  assert.equal(db.episodes.size, 1);
  assert.ok(db.episodes.has(episodeKey(PODCASTS[1].id, 9)));
  assert.ok(logs.some((message) => message.includes("Kon geen aflevering")));
});

test("een mislukte feed verhindert de volgende podcastfeed niet", async () => {
  const db = makePodcastDb();
  const logs: string[] = [];
  await withFeedFetch(feeds(new Error("DNS mislukt"), xmlEpisode("10", "10: De tweede feed werkt")), async () => {
    await syncPodcastFeed(db.client, (message) => logs.push(message));
  });

  assert.ok(db.episodes.has(episodeKey(PODCASTS[1].id, 10)));
  assert.ok(logs.some((message) => message.includes("Feed van") && message.includes("overgeslagen")));
  assert.equal(db.exerciseCalls(), 0);
});

test("podcastfeed-ticker draait direct, daarna hooguit elk uur", async () => {
  let calls = 0;
  const ticker = createPodcastFeedSyncTicker(async () => { calls++; });

  assert.equal(await ticker.run(0), true);
  assert.equal(await ticker.run(1), false);
  assert.equal(await ticker.run(PODCAST_FEED_SYNC_INTERVAL_MS), true);
  assert.equal(calls, 2);
});

test("podcastfeed-ticker voorkomt overlap en laat na een fout later een nieuwe poging toe", async () => {
  let release: (() => void) | null = null;
  let calls = 0;
  const ticker = createPodcastFeedSyncTicker(async () => {
    calls++;
    if (calls === 1) await new Promise<void>((resolve) => { release = resolve; });
    if (calls === 2) throw new Error("tijdelijk onbereikbaar");
  });

  const first = ticker.run(0);
  assert.equal(await ticker.run(0), false);
  release!();
  assert.equal(await first, true);
  await assert.rejects(() => ticker.run(PODCAST_FEED_SYNC_INTERVAL_MS), /tijdelijk onbereikbaar/);
  assert.equal(await ticker.run(PODCAST_FEED_SYNC_INTERVAL_MS * 2), true);
  assert.equal(calls, 3);
});
