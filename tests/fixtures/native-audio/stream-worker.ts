// Alleen eigen geïsoleerde native audioproef; nooit native credentials naar stdout.
import { createHash } from "node:crypto";
import { prisma } from "../../../src/lib/db";
import { nativeSessionIdentity } from "../../../src/lib/native/sessions";
import { streamNativeReaderAudio } from "../../../src/lib/native/audio.server";
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),input=JSON.parse(process.env.NATIVE_AUDIO_WORKER_INPUT??"null");
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.DATABASE_URL||!process.env.AUDIO_DIR?.startsWith("/tmp/versado-native-audio-")||!input)throw Error("Eigen audioproef vereist");
try{
 const {binding}=await nativeSessionIdentity(input.token);
 const response=await streamNativeReaderAudio(binding,input.courseId,"steps",input.targetId,input.sourceId,"bytes=0-999",true,input.token);
 const bytes=Buffer.from(await response.arrayBuffer());
 process.stdout.write(JSON.stringify({status:response.status,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}));
}finally{await prisma.$disconnect();const shared=globalThis as typeof globalThis&{__versadoAuthBudget?:Promise<{disconnect():void}>};await shared.__versadoAuthBudget?.then(client=>client.disconnect()).catch(()=>{});}
