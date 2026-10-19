import {getCurrentUser} from "@/lib/session";
import {redirect,notFound} from "next/navigation";
import {requireDorpAccess,DorpError} from "./service";
import {prisma} from "@/lib/db";
export async function dorpPageActor(){
 const user=await getCurrentUser();if(!user)redirect("/login");
 try{await requireDorpAccess(prisma,user.id);}catch(e){if(e instanceof DorpError)notFound();throw e;}
 return user;
}
