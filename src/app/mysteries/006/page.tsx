import MysteryDetailPage from "@/components/mysteries/MysteryDetailPage";
import { MYSTERY_006A } from "@/lib/mysteries/mystery006a";
import { MYSTERY_006B } from "@/lib/mysteries/mystery006b";
import { MYSTERY_006C } from "@/lib/mysteries/mystery006c";

export default function Mystery006DetailPage() {
  return <MysteryDetailPage config={{ number: 6, eyebrowKey: "mystery006.eyebrow", titleKey: "mystery006.title", introKey: "mystery006.intro", definitions: [MYSTERY_006A, MYSTERY_006B, MYSTERY_006C], paths: ["/mysteries/006a/play", "/mysteries/006b/play", "/mysteries/006c/play"] }} />;
}
