import { z } from "zod";
export const nativeTokensSchema = z.object({ accessToken: z.string().min(1).max(2048), refreshToken: z.string().min(1).max(128), expiresIn: z.literal(300) });
export const nativeSetupSchema = z.object({ securitySetup: z.object({
  token: z.string().max(128).regex(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/),
  step: z.enum(["password", "totp"]), expiresAt: z.iso.datetime(),
  secret: z.string().min(16).max(128).regex(/^[A-Z2-7]+$/).optional(),
  otpauthUri: z.string().startsWith("otpauth://totp/").max(1024).optional(),
}).strict().refine(value => value.step === "totp" ? !!value.secret && !!value.otpauthUri : !value.secret && !value.otpauthUri) }).strict();
export type NativeSecuritySetup = z.infer<typeof nativeSetupSchema>["securitySetup"];
export const nativeSetupFinishSchema = z.object({ challengeToken: z.string().min(1).max(128), newPassword: z.string().min(8).max(256).optional(), code: z.string().min(1).max(100).optional() }).strict();
export const nativeCapabilitiesSchema = z.object({ apiVersion: z.literal(1), apple: z.boolean(), registration: z.boolean(), features: z.array(z.string()).default([]) });
export const nativeAccountSchema = z.object({ id: z.string(), handle: z.string(), uiLanguage: z.string(), onboardingRequired: z.boolean(), appleLinked: z.boolean(), passwordLoginEnabled: z.boolean(), totpEnabled: z.boolean().default(false) });
export const nativeTodaySchema = z.object({ activity: z.object({ id: z.string(), title: z.string() }).nullable() });
export const nativeChapterSchema = z.object({ id: z.string(), title: z.string(), verses: z.array(z.object({ number: z.number().int().positive(), text: z.string() })).max(499), state: z.object({ read: z.enum(["UNREAD", "READING", "READ"]) }).passthrough() });
export type NativeAccount = z.infer<typeof nativeAccountSchema>;
export type NativeChapter = z.infer<typeof nativeChapterSchema>;
