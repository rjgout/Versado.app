import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const count = z.number().int().nonnegative();
const courseType = z.enum(["FRONT_TO_BACK","FREE_CHOICE","BY_BOOK","PODCAST","KIDS","INTRO","READING_LESSONS","FSY","STUDY_STEPS","STUDY_FREE"]);
const basic = z.object({ id, slug: z.string(), type: courseType, name: z.string(), description: z.string().nullable(), totalChapters: count, unitPlural: z.string().optional(), artwork: z.array(z.string()) });
export const courseCardSchema = basic.extend({ completedCount: count, xpAvailable: count, isActive: z.boolean(), currentChapter: z.object({id,bookName:z.string(),number:count}).nullable(), resumeHref:z.string().startsWith("/"), resumeReason:z.enum(["calendar","selected","studied"]).nullable().optional(), imageSrc:z.string().nullable().optional() });
const state = z.enum(["UNREAD","READING","READ"]);
const chapter = z.object({id,number:count,bookKey:z.string().nullable(),bookName:z.string(),read:state,exercisesAnswered:count,exercisesTotal:count});
const pathChapter = chapter.extend({lessonCount:count,completedLessons:count,locked:z.boolean(),steps:z.array(z.object({id,number:count,startVerse:count,endVerse:count,done:z.boolean(),available:z.boolean()}))});
const pathItem = chapter.extend({verseCount:count,exerciseScore:z.number().nullable(),completed:z.boolean()});
const context = { version:z.literal(1), userId:id, activeCollectionId:z.string().nullable(), selectionVersion:count, language:z.enum(["nl","en","de","fr","es"]) };
export const nativeCoursesSchema = z.object({...context,courses:z.array(courseCardSchema),catalog:z.array(basic)}).strict();
export const nativeCoursePathSchema = z.discriminatedUnion("kind",[
 z.object({...context,kind:z.literal("steps"),courseId:id,courseName:z.string(),unitPlural:z.string(),chapters:z.array(pathChapter),todayId:id.nullable()}).strict(),
 z.object({...context,kind:z.literal("chapters"),courseId:id,courseName:z.string(),unitPlural:z.string(),sequential:z.boolean(),chapters:z.array(pathItem),todayId:id.nullable(),todayMinutes:z.number().nonnegative(),todayXp:count,defaultOpenBook:z.string().nullable()}).strict(),
]);
export type NativeCourses = z.infer<typeof nativeCoursesSchema>;
export type NativeCoursePath = z.infer<typeof nativeCoursePathSchema>;
export const nativeCourseId = id;
