"use client";
import { useRouter } from "next/navigation";
import { liveMutation } from "@/lib/data/mutation";
import FriendRequestControl from "./FriendRequestControl";
export default function FriendRequestButtons({ friendshipId, name }: { friendshipId: string; otherUserId: string; name: string }) {
  const router = useRouter();
  async function respond(action: "accept" | "decline") {
    await liveMutation(async () => {
      const response = await fetch(`/api/friends/${friendshipId}/${action}`, { method: "POST" });
      if (!response.ok) throw new Error("friend_response_failed");
    }, { invalidates: "friendsChanged" });
    // Server emit verzorgt beide gebruikers; geen dubbele client-socketmelding.
    router.refresh();
  }
  return <FriendRequestControl name={name} respond={respond}/>;
}
