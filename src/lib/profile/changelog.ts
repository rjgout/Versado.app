import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
export async function loadProfileChangelog(){
  const entries=await prisma.changelogEntry.findMany({orderBy:{createdAt:"desc"}});
  return entries.map(entry=>({id:entry.id,title:entry.title,body:entry.body,createdAt:entry.createdAt.toISOString()}));
}
export async function markProfileChangelogSeen(tx:Pick<Prisma.TransactionClient,"user">,userId:string){
  await tx.user.update({where:{id:userId},data:{changelogSeenAt:new Date()}});
}
