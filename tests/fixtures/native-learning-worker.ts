// Twee echte Node-processen met uitsluitend de eigen geïsoleerde database.
import { readFileSync } from "node:fs";
import { prisma } from "../../src/lib/db";
import { submitNativeLearning } from "../../src/lib/native/learning.server";
const url=new URL(process.env.DATABASE_URL??"http://invalid");
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_content_access_test"||process.env.NATIVE_TEST_DATABASE_URL!==url.href)throw Error("Alleen geïsoleerde testdatabase");
const input=JSON.parse(readFileSync(0,"utf8"));
try {
  const result=await submitNativeLearning(input.binding,input.courseId,input.kind,input.targetId,input.input);
  process.stdout.write("RESULT:"+JSON.stringify(result)+"\n");
} finally { await prisma.$disconnect(); }
