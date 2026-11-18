import type {Socket} from "socket.io-client";
import {applicationRuntime} from "@/lib/data/applicationRuntime";

/** Native buildadapter voor dezelfde gedeelde spelcomponenten. Alleen de
 * bestaande, sessiegebonden ticketverbinding; geen webcookie of tweede socket. */
export function getSocket():Socket {
 const runtime=applicationRuntime();
 if(!runtime)throw new Error("native_realtime_unavailable");
 return runtime.socket();
}
