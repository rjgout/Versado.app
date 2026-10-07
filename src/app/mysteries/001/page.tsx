import MysteryDetailPage from "@/components/mysteries/MysteryDetailPage";
import { MYSTERY_001A } from "@/lib/mysteries/mystery001a";
import { MYSTERY_001B } from "@/lib/mysteries/mystery001b";
import { MYSTERY_001C } from "@/lib/mysteries/mystery001c";

/** Canonieke detailroute voor Mysterie 001; de oude /001a-route blijft compatibel. */
export default function Mystery001Page() {
  return <MysteryDetailPage config={{
    number: 1,
    eyebrowKey: "mystery001a.eyebrow",
    titleKey: "mystery001a.title",
    introKey: "mystery001a.intro",
    definitions: [MYSTERY_001A, MYSTERY_001B, MYSTERY_001C],
    paths: ["/mysteries/001a/play", "/mysteries/001b/play", "/mysteries/001c/play"],
  }} />;
}
