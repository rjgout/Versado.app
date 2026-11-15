"use client";
import {useCallback,useEffect,type ReactNode} from "react";
import {useAppNavigation} from "@/components/navigation/AppNavigation";
import KompasRuntimeProvider,{KOMPAS_TOUR_PARAM} from "@/components/kompas/KompasRuntimeProvider";
function AddressReader({onTour}:{onTour:(id:string,path:string)=>void}){
 const navigation=useAppNavigation(),path=navigation.pathname.split("?")[0],id=new URLSearchParams(navigation.pathname.split("?")[1]??"").get(KOMPAS_TOUR_PARAM);
 useEffect(()=>{if(id)onTour(id,path);},[id,path,onTour]);return null;
}
export default function NativeKompasProvider({children}:{children:ReactNode}){
 const navigation=useAppNavigation(),{replace}=navigation;
 const clearAddress=useCallback((at:string)=>replace(at,{scroll:false}),[replace]);
 return <KompasRuntimeProvider pathname={navigation.pathname.split("?")[0]} push={navigation.push} clearAddress={clearAddress} AddressReader={AddressReader}>{children}</KompasRuntimeProvider>;
}
