import { z } from "zod";
const code=z.string().min(1).max(100);
export const twoFactorCommand=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("setup")}).strict(),
  z.object({kind:z.literal("verify"),code}).strict(),
  z.object({kind:z.literal("reset"),code}).strict(),
  z.object({kind:z.literal("disable"),code}).strict(),
]);
export type TwoFactorCommand=z.infer<typeof twoFactorCommand>;
export const twoFactorResult=z.union([
  z.object({secret:z.string().min(16).max(128).regex(/^[A-Z2-7]+$/),otpauthUri:z.string().startsWith("otpauth://totp/").max(1024)}).strict(),
  z.object({ok:z.literal(true),recoveryCodes:z.array(z.string().min(1).max(100)).max(20)}).strict(),
  z.object({ok:z.literal(true)}).strict(),
]);
export type TwoFactorResult=z.infer<typeof twoFactorResult>;
