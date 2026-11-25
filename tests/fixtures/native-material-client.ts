// Uitsluitend de OS-voorkeurgrens voor geautomatiseerde browserproeven.
// De echte entry gebruikt dezelfde startfunctie met de UIKit-bridge.
import { useEffect } from "react";
import { startNativeAppearance } from "../../src/lib/native/appearance";
export function useTestMaterial() {
  useEffect(() => {
    if(new URLSearchParams(location.search).get("material")!=="ios")return;
    return startNativeAppearance({
      read: async()=>({version:1,reduceTransparency:false,reduceMotion:false,increaseContrast:false,fontScale:1}),
      listen:async callback=>{
        const listener=(event:Event)=>callback((event as CustomEvent).detail);
        window.addEventListener("glass:test-preferences",listener);
        return {remove:async()=>window.removeEventListener("glass:test-preferences",listener)};
      },
    },{platform:"ios",root:document.documentElement,onChange:()=>window.dispatchEvent(new Event("resize"))});
  },[]);
}
