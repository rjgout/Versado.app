"use client";
import {createContext,useContext} from "react";
import type {AnnotationActionsAdapter} from "./AnnotationActionsView";
import type {AnnotationList} from "@/lib/annotations/clientContract";
import type {QueryKey} from "@/lib/data/store";
/** Alleen platformtransport; dezelfde reader en annotatiebediening. */
export const AnnotationTransportContext=createContext<{chapterId:string;key:QueryKey;load():Promise<AnnotationList>;adapter:AnnotationActionsAdapter}|null>(null);
export const useAnnotationTransport=()=>useContext(AnnotationTransportContext);
