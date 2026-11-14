"use client";
import {useCallback,useEffect,type ReactNode} from "react";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import KompasRuntimeProvider,{KOMPAS_TOUR_PARAM} from "./KompasRuntimeProvider";
export {useKompas,KOMPAS_TOUR_PARAM} from "./KompasRuntimeProvider";
export default function KompasProvider({children}:{children:ReactNode}){
 const pathname=usePathname(),router=useRouter();
 const push=useCallback((href:string)=>router.push(href),[router]);
 const clearAddress=useCallback(()=>{const url=new URL(window.location.href);url.searchParams.delete(KOMPAS_TOUR_PARAM);window.history.replaceState(window.history.state,"",`${url.pathname}${url.search}${url.hash}`);},[]);
 return <KompasRuntimeProvider pathname={pathname} push={push} clearAddress={clearAddress} AddressReader={TourFromAddress}>{children}</KompasRuntimeProvider>;
}
/** Leest ?kompas=<rondleiding> uit het adres; apart zodat alleen dit deel op de zoekparameters wacht. */
function TourFromAddress({ onTour }: { onTour: (tourId: string, pathname: string) => void }) {
  const param = useSearchParams().get(KOMPAS_TOUR_PARAM);
  // Het pad komt mee uit dezelfde render als de param: een effect van een kind loopt vóór dat van de provider.
  const pathname = usePathname();
  useEffect(() => {
    if (param) onTour(param, pathname);
  }, [param, pathname, onTour]);
  return null;
}
