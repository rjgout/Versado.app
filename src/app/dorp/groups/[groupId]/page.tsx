import {notFound} from "next/navigation";
import ServerDorpClient from "@/components/dorp/ServerDorpClient";
import {dorpPageActor} from "@/lib/dorp/pageAccess";
import {prisma} from "@/lib/db";
export default async function GroupDorpPage({params}:{params:Promise<{groupId:string}>}){
 const user=await dorpPageActor(),{groupId}=await params;
 if(groupId.length>128||!await prisma.groupMembership.findFirst({where:{groupId,userId:user.id,leftAt:null},select:{id:true}}))notFound();
 return <ServerDorpClient key={groupId} userId={user.id} groupId={groupId}/>;
}
