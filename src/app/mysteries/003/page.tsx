import MysteryDetailPage from "@/components/mysteries/MysteryDetailPage";
import { MYSTERY_003A } from "@/lib/mysteries/mystery003a";
import { MYSTERY_003B } from "@/lib/mysteries/mystery003b";
import { MYSTERY_003C } from "@/lib/mysteries/mystery003c";

export default function Mystery003DetailPage() {
  return <MysteryDetailPage config={{ number: 3, eyebrowKey: "mystery003.eyebrow", titleKey: "mystery003.title", introKey: "mystery003.intro", definitions: [MYSTERY_003A, MYSTERY_003B, MYSTERY_003C], paths: ["/mysteries/003a/play", "/mysteries/003b/play", "/mysteries/003c/play"] }} />;
}
