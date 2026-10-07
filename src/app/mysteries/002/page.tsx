import MysteryDetailPage from "@/components/mysteries/MysteryDetailPage";
import { MYSTERY_002A } from "@/lib/mysteries/mystery002a";
import { MYSTERY_002B } from "@/lib/mysteries/mystery002b";
import { MYSTERY_002C } from "@/lib/mysteries/mystery002c";

export default function Mystery002DetailPage() {
  return <MysteryDetailPage config={{
    number: 2,
    eyebrowKey: "mystery002a.eyebrow",
    titleKey: "mystery002a.title",
    introKey: "mystery002a.intro",
    definitions: [MYSTERY_002A, MYSTERY_002B, MYSTERY_002C],
    paths: ["/mysteries/002a/play", "/mysteries/002b/play", "/mysteries/002c/play"],
  }} />;
}
