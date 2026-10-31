import { applyPersonalOrder } from "@/lib/listOrder";
import { prisma } from "@/lib/db";
import { getContentPickerContext } from "@/lib/contentCollections";
import { getUserCourses } from "@/lib/learning/courseList.server";
import { getCourseCatalog } from "@/lib/learning/courseCatalog.server";
import { loadReadingPath } from "@/lib/readingPathData";
import { loadChapterPath } from "@/lib/chapterPathData";
import { readingAccessWhere } from "@/lib/contentAccess";
import { isReadingPathType } from "@/lib/readingCourses";
import { courseTypeMatchesContent } from "@/lib/courseContent";
import { localizedCourse } from "@/lib/courseText";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { getT } from "@/lib/i18n";
import { activeNativeSession, NativeAuthError, type NativeSessionBinding } from "./sessions";
import { nativeCoursesSchema, nativeCoursePathSchema } from "./coursesContract";

async function context(binding: NativeSessionBinding) {
 const user = await activeNativeSession(binding), picker = await getContentPickerContext(user.id);
 if (user.contentSelectionVersion !== picker.selectionVersion) throw new NativeAuthError("content_context_changed",409);
 return {user,picker};
}
async function recheck(binding: NativeSessionBinding, original: Awaited<ReturnType<typeof context>>) {
 const latest = await context(binding);
 if (latest.user.uiLanguage !== original.user.uiLanguage || latest.user.timeZone !== original.user.timeZone || latest.user.isAdmin !== original.user.isAdmin || latest.picker.selectionVersion !== original.picker.selectionVersion || latest.picker.activeCollectionId !== original.picker.activeCollectionId) throw new NativeAuthError("content_context_changed",409);
 return latest;
}
function envelope(value: Awaited<ReturnType<typeof context>>) {
 return {version:1 as const,userId:value.user.id,activeCollectionId:value.picker.activeCollectionId,selectionVersion:value.picker.selectionVersion,language:value.user.uiLanguage};
}
export async function nativeCourses(binding: NativeSessionBinding) {
 const value=await context(binding);
 if (!value.picker.activeCollectionId) { await recheck(binding,value); return nativeCoursesSchema.parse({...envelope(value),courses:[],catalog:[]}); }
 const [courses,catalog,order]=await Promise.all([getUserCourses(value.user),getCourseCatalog(value.user),prisma.userListOrder.findMany({where:{userId:value.user.id,listKey:"courses",hidden:false},orderBy:{order:"asc"},select:{itemKey:true}})]);
 await recheck(binding,value);
 return nativeCoursesSchema.parse({...envelope(value),courses:applyPersonalOrder(courses,order.map(row=>row.itemKey)),catalog});
}
export async function nativeCoursePath(binding: NativeSessionBinding, courseId: string) {
 const value=await context(binding);
 const where={id:courseId,enabled:true,contentCollectionId:value.picker.activeCollectionId ?? "",contentCollection:readingAccessWhere(value.user)};
 const course=await prisma.course.findFirst({where,include:{contentCollection:{select:{work:true}}}});
 if (!course || !courseTypeMatchesContent(course.type,course.contentCollection.work) || !isReadingPathType(course.type)) throw new NativeAuthError("content_unavailable",404);
 const base={...envelope(value),courseId,courseName:localizedCourse({...course,work:course.contentCollection.work},value.user.uiLanguage).name,unitPlural:localizeTerm(chapterTerm(null,course.contentCollectionId),getT(value.user.uiLanguage)).plural};
 const data=course.type === "READING_LESSONS" ? {kind:"steps" as const,...await loadReadingPath(prisma,value.user.id,course.id,{readOnly:true})} : {kind:"chapters" as const,sequential:course.type !== "FREE_CHOICE",...await loadChapterPath(prisma,value.user.id,course,{readOnly:true})};
 await recheck(binding,value);
 if (!await prisma.course.findFirst({where,select:{id:true}})) throw new NativeAuthError("content_unavailable",404);
 return nativeCoursePathSchema.parse({...base,...data});
}
