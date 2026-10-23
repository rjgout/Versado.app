import { prisma } from "../../../src/lib/db";
import { importAudioPackage } from "../../../src/lib/audio/library";
const url = new URL(process.env.AUDIO_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_audio_test" || process.env.DATABASE_URL !== url.href) throw new Error("Eigen audiorunner vereist");
try { console.log((await importAudioPackage(process.argv[2])).status); }
finally { await prisma.$disconnect(); }
