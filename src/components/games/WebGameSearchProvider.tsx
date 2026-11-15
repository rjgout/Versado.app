"use client";
import {usePathname,useSearchParams} from "next/navigation";
import type {ReactNode} from "react";
import {GameNavigationProvider} from "./GameNavigation";
/** Alleen de webplatformadapter gebruikt de Next-routecontext. */
export default function WebGameSearchProvider({children}:{children:ReactNode}) {
  const path=usePathname(),query=useSearchParams().toString();
  return <GameNavigationProvider href={`${path}${query?`?${query}`:""}`}>{children}</GameNavigationProvider>;
}
