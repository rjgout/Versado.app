import { promises as fs } from "node:fs";
import { prisma } from "../../../src/lib/db";
import { runOfficialAudioTick } from "../../../src/lib/audio/officialJobs";
import { mockOfficialNetwork,type OfficialMock } from "./official-network";
const url=new URL(process.env.AUDIO_TEST_DATABASE_URL??"http://invalid");
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_audio_test"||process.env.DATABASE_URL!==url.href)throw Error("Eigen audiorunner vereist");
try{const config=JSON.parse(await fs.readFile(process.argv[2],"utf8")) as OfficialMock;await runOfficialAudioTick(prisma,mockOfficialNetwork(config),config.sources);}finally{await prisma.$disconnect();}
