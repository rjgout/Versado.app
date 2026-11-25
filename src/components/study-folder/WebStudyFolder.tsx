"use client";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import StudyFolderClient from "./StudyFolderClient";
import AnnotationActions from "@/components/annotations/AnnotationActions";
import {fetchJson} from "@/lib/data/fetchJson";
export default function WebStudyFolder(){
  const pathname=usePathname(),router=useRouter(),search=useSearchParams();
  return <StudyFolderClient pathname={pathname} search={new URLSearchParams(search.toString())} replace={router.replace}
    request={query=>fetchJson(`/api/study-folder?${query}`)}
    renderEditor={(item,element,onClose,onChanged)=><AnnotationActions key={`${item.kind}:${item.id}`} target={item.target} returnFocus={element} onClose={onClose} onChanged={onChanged}/>}/>;
}
