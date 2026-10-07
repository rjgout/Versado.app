import MysteryDetailPage from "@/components/mysteries/MysteryDetailPage";
import { MYSTERY_005A } from "@/lib/mysteries/mystery005a";
import { MYSTERY_005B } from "@/lib/mysteries/mystery005b";
import { MYSTERY_005C } from "@/lib/mysteries/mystery005c";

export default function Mystery005DetailPage() {
  return <MysteryDetailPage config={{ number: 5, eyebrowKey: "mystery005.eyebrow", titleKey: "mystery005.title", introKey: "mystery005.intro", definitions: [MYSTERY_005A, MYSTERY_005B, MYSTERY_005C], paths: ["/mysteries/005a/play", "/mysteries/005b/play", "/mysteries/005c/play"] }} />;
}
