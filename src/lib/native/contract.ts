import { z } from "zod";
export const nativeTokensSchema = z.object({ accessToken: z.string().min(1).max(2048), refreshToken: z.string().min(1).max(128), expiresIn: z.literal(300) });
export const nativeAccountSchema = z.object({ id: z.string(), handle: z.string(), uiLanguage: z.string(), onboardingRequired: z.boolean(), appleLinked: z.boolean(), passwordLoginEnabled: z.boolean() });
export const nativeTodaySchema = z.object({ activity: z.object({ id: z.string(), title: z.string() }).nullable() });
export const nativeChapterSchema = z.object({ id: z.string(), title: z.string(), verses: z.array(z.object({ number: z.number().int().positive(), text: z.string() })).max(499), state: z.object({ read: z.enum(["UNREAD", "READING", "READ"]) }).passthrough() });
export type NativeAccount = z.infer<typeof nativeAccountSchema>;
export type NativeChapter = z.infer<typeof nativeChapterSchema>;
