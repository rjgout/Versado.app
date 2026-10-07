import MysteryDetailPage from "@/components/mysteries/MysteryDetailPage";
import { MYSTERY_004A } from "@/lib/mysteries/mystery004a";
import { MYSTERY_004B } from "@/lib/mysteries/mystery004b";
import { MYSTERY_004C } from "@/lib/mysteries/mystery004c";

export default function Mystery004DetailPage() {
  return <MysteryDetailPage config={{ number: 4, eyebrowKey: "mystery004.eyebrow", titleKey: "mystery004.title", introKey: "mystery004.intro", definitions: [MYSTERY_004A, MYSTERY_004B, MYSTERY_004C], paths: ["/mysteries/004a/play", "/mysteries/004b/play", "/mysteries/004c/play"] }} />;
}
