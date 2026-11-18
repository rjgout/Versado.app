import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
const database=new URL(process.env.DATABASE_URL??"http://invalid");
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.NATIVE_TEST_DATABASE_URL)throw Error("Alleen geïsoleerde database");
const client=new PrismaClient({adapter:new PrismaPg({connectionString:database.href,max:1,connectionTimeoutMillis:1000}),log:[]});
(globalThis as unknown as {prisma:PrismaClient}).prisma=client;
try {
 const {mutateNativeReaderAnnotation}=await import("../../src/lib/native/annotations.server");
 const {binding,courseId,kind,targetId,input}=JSON.parse(process.argv[2]);
 try {process.stdout.write(JSON.stringify({ok:true,result:await mutateNativeReaderAnnotation(binding,courseId,kind,targetId,input)}));}
 catch(error){process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error?error.message:"failure"}));}
}finally{await client.$disconnect();}
