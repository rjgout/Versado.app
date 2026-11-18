"use client";
import {createContext,useContext,useMemo,type ReactNode} from "react";
import {useAppNavigation} from "@/components/navigation/AppNavigation";

const Context=createContext<{href:string;shareOrigin?:string}|null>(null);
export function GameNavigationProvider({href,shareOrigin,children}:{href:string;shareOrigin?:string;children:ReactNode}) {
  const value=useMemo(()=>({href,shareOrigin}),[href,shareOrigin]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useGameRouter(){
  const {push,replace,back,refresh}=useAppNavigation();
  return useMemo(()=>({push,replace,back,refresh}),[push,replace,back,refresh]);
}
export function useGamePathname(){const value=useContext(Context),navigation=useAppNavigation();return (value?.href??navigation.pathname).split("?")[0];}
export function useGameSearchParams(){
  const value=useContext(Context),navigation=useAppNavigation();
  const query=(value?.href??navigation.pathname).split("?")[1]??"";
  return useMemo(()=>new URLSearchParams(query),[query]);
}
export function useGameShareOrigin(){return useContext(Context)?.shareOrigin ?? (typeof window==="undefined"?"":window.location.origin);}
