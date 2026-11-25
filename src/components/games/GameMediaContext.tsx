"use client";
import {createContext,useContext,type ComponentProps,type ComponentType} from "react";
import type ReadAloudPlayer from "@/components/ReadAloudPlayer";
import type IntroAudioButton from "@/components/IntroAudioButton";
/** Platformadapter rond de bestaande lees-/luisterbediening; web houdt zijn
 * bestaande uitvoering. Geen audiospeler of autorisatie in deze context. */
export const GameMediaContext=createContext<{
 Reading:ComponentType<ComponentProps<typeof ReadAloudPlayer>>;
 Intro:ComponentType<ComponentProps<typeof IntroAudioButton>>;
 speak?(text:string,language:string,index:number,onDone?:()=>void):void;
}|null>(null);
export const useGameMedia=()=>useContext(GameMediaContext);
