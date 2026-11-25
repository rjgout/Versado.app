import { nativeCourseId } from "./coursesContract";
import { nativeReaderKind, type NativeReaderKind } from "./readerContract";
import { nativeLearningStart, nativeLearningSubmit, nativeLearningCheck, type NativeLearningStart, type NativeLearningSubmit, type NativeLearningCheck, type NativeLearningSession } from "./learningContract";
import { NativeClientError, type NativeSessionClient } from "./client";
import { z } from "zod";

/** B3c-2 sluit hier de bestaande vragenpresentatie op aan. De gedeelde
 * NativeSessionClient bewaakt account/epoch. Geen eigen cache of wachtrij.
 * Een POST wordt ook na session_expired nooit automatisch herhaald. */
export function nativeLearningClient(client: NativeSessionClient, courseId: string, kind: NativeReaderKind, targetId: string) {
  const path=`courses/${nativeCourseId.parse(courseId)}/read/${nativeReaderKind.parse(kind)}/${nativeCourseId.parse(targetId)}/learning`;
  const stamp=client.getSessionStamp();
  const current=()=>{if(client.getSessionStamp()!==stamp)throw new NativeClientError("session_changed",401);};
  return {
    start: (input: NativeLearningStart) => { current(); return client.api<NativeLearningSession>(path+"/start", nativeLearningStart.parse(input),"POST",false); },
    submit: (input: NativeLearningSubmit) => { current(); return client.api<NativeLearningSession>(path+"/submit",nativeLearningSubmit.parse(input),"POST",false); },
    read: (input: NativeLearningStart) => { current(); return client.api<NativeLearningSession>(path+"/read",nativeLearningStart.parse(input),"POST",false); },
    check: (input: NativeLearningCheck) => { current(); return client.api<{version:1;exerciseId:string;correct:boolean;correctAnswer:string[]}>(path+"/check",nativeLearningCheck.parse(input),"POST",false); },
    status: (sessionId: string) => { current(); return client.api<NativeLearningSession>(path+"/sessions/"+z.uuid().parse(sessionId)); },
  };
}
