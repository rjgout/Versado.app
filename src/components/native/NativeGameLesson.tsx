"use client";
import type {ComponentProps} from "react";
import SharedLessonFlow from "@/components/learning/SharedLessonFlow";
import {useGameMedia} from "@/components/games/GameMediaContext";
import {useAnnotationTransport} from "@/components/annotations/AnnotationTransport";
import {useNativeData} from "@/lib/data/nativeHooks";
import {NativeClientError} from "@/lib/native/client";

/** Dezelfde volledige les; native vereist zijn eigen bestaande media- en
 * annotatiepoort en kan nooit op webcookies of webannotaties terugvallen. */
export default function NativeGameLesson(props:ComponentProps<typeof SharedLessonFlow>):ReturnType<typeof SharedLessonFlow>{
 useNativeData();
 const media=useGameMedia(),annotations=useAnnotationTransport();
 if(!media||!annotations||annotations.chapterId!==props.chapterId)throw new NativeClientError("native_runtime_unavailable",503);
 return <SharedLessonFlow {...props}/>;
}
