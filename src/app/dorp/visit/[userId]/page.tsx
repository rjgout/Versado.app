import {notFound} from "next/navigation";
import ServerDorpClient from "@/components/dorp/ServerDorpClient";
import {dorpPageActor} from "@/lib/dorp/pageAccess";
import {visitVillage,DorpError} from "@/lib/dorp/service";
export default async function VisitDorpPage({params}:{params:Promise<{userId:string}>}){
 const actor=await dorpPageActor(),{userId}=await params;
 try{await visitVillage(actor.id,userId);}catch(e){if(e instanceof DorpError)notFound();throw e;}
 return <ServerDorpClient key={userId} userId={actor.id} ownerId={userId}/>;
}
