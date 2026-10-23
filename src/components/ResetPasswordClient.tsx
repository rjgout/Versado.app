"use client";
import { useRouter } from "next/navigation";
import PasswordResetForm from "@/components/account/PasswordResetForm";
import { webPasswordResetActions } from "@/lib/account/passwordResetWeb";

export default function ResetPasswordClient({ token }: { token: string | null }) {
  const router = useRouter();
  return <PasswordResetForm key={token} token={token} actions={webPasswordResetActions} onCompleted={() => { router.push("/dashboard"); router.refresh(); }} />;
}
