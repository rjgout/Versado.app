"use client";

import { useEffect } from "react";
import { liveData } from "./client";
import { subscribeTopic } from "./topics";
import type { QueryKey } from "./store";
import type { LiveTopic } from "./scopes";
import { useQueryStore, type UseLiveQueryOptions, type LiveQueryResult } from "./queryHooks";
export { ContentViewContext, ContentScopeContext, useContentView, useContentScope } from "./queryHooks";
export type { ContentScope, UseLiveQueryOptions, LiveQueryResult } from "./queryHooks";

/** Bestaande webadapter; de gedeelde hook heeft geen cookie- of Socket.io-afhankelijkheid. */
export function useLiveQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: UseLiveQueryOptions<T>): LiveQueryResult<T> {
  return useQueryStore(liveData, key, fetcher, options);
}

/** Volg een realtime-onderwerp zolang de component in beeld is (zie LIVE_TOPICS in scopes.ts). */
export function useLiveTopic(topic: LiveTopic, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return subscribeTopic(topic);
  }, [topic, enabled]);
}
