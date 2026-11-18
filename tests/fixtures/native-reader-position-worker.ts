import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
const database=new URL(process.env.DATABASE_URL??"http://invalid");
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.NATIVE_TEST_DATABASE_URL)throw Error("Alleen geïsoleerde database");
// Eén beschikbare verbinding bootst een volledig bezette pool na. De commit
// moet alle autorisatie-/domeinqueries op zijn eigen tx uitvoeren.
const client=new PrismaClient({adapter:new PrismaPg({connectionString:database.href,max:1,connectionTimeoutMillis:500}),log:[]});
(globalThis as unknown as {prisma:PrismaClient}).prisma=client;
try {
  const {saveNativeReaderPosition}=await import("../../src/lib/native/readerPosition.server");
  const {binding,courseId,kind,targetId,input}=JSON.parse(process.argv[2]);
  const result=await saveNativeReaderPosition(binding,courseId,kind,targetId,input);
  process.stdout.write(JSON.stringify(result));
}finally{await client.$disconnect();}
