"use client";
// Dezelfde onderwerpen en teller per bestaande verbinding, voor web én native.
import {getSocket} from "@/lib/socketClient";
import type {Socket} from "socket.io-client";
import type {LiveTopic} from "./scopes";
const subscriptions=new WeakMap<Socket,Map<LiveTopic,number>>();
export function subscribeTopic(topic:LiveTopic,socket:Socket=getSocket()):()=>void {
  let counts=subscriptions.get(socket);
  if(!counts){
    counts=new Map();subscriptions.set(socket,counts);
    const current=counts;
    socket.on("connect",()=>{for(const name of current.keys())socket.emit("data_subscribe",{topic:name});});
  }
  const next=(counts.get(topic)??0)+1;counts.set(topic,next);
  if(next===1&&socket.connected)socket.emit("data_subscribe",{topic});
  let released=false;
  return()=>{
    if(released)return;released=true;
    const left=(counts.get(topic)??1)-1;
    if(left<=0){counts.delete(topic);if(socket.connected)socket.emit("data_unsubscribe",{topic});}
    else counts.set(topic,left);
  };
}
