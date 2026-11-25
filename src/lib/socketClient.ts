"use client";

import { applicationRuntime, nativeApplicationInstalled } from "@/lib/data/applicationRuntime";
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  const platform = applicationRuntime();
  if (platform) return platform.socket();
  if (nativeApplicationInstalled()) throw new Error("native_realtime_unavailable");
  if (!socket) {
    socket = io({ path: "/socket.io", withCredentials: true });
  }
  return socket;
}
