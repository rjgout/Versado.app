// Reproductie van de live audioketen met een echt audiobestand (geen synthese): extractor -> herkenner of score-follower -> positie.
// Draait ongewijzigd op zowel de oude (3 proeflofzangen) als de nieuwe (volledige bibliotheek) code.
//   npx tsx scripts/hymns/repro-live-audio.ts <follow|recognize> <wav> <lofzangnummer> [chunk=2048]
// Het bestand moet mono 16-bit PCM-WAV zijn (ffmpeg -ac 1). De audio komt nooit in git (bronrechten).
import { HymnLiveEngine } from "../../src/lib/hymns/live";
import { readWav } from "./wav";

const [mode, wavPath, numberArg, chunkArg] = process.argv.slice(2);
const number = Number(numberArg);
const chunk = Number(chunkArg ?? 2048);

async function main() {
  const lib = await import("../../src/lib/hymns/library");
  const hymns = lib.listHymns(lib.POC_LIBRARY);
  const engine = new HymnLiveEngine(hymns);
  if (mode === "recognize") {
    // nieuwe code: de volledige bibliotheek als herkenningsbundel (zoals /api/hymns/recognition); oude code: de proeflofzangen zelf
    let usedBundle = false;
    try {
      const { loadRecognitionBundle } = await import("../../src/lib/hymns/library/server");
      const { candidatesFromBundle } = await import("../../src/lib/hymns/recognize/candidates");
      const bundle = loadRecognitionBundle();
      engine.setCandidates(candidatesFromBundle(bundle));
      usedBundle = true;
      console.log(`bundel: ${bundle.compositions.length} composities`);
    } catch {
      /* oude code: geen bundel */
    }
    if (usedBundle) {
      // de gevonden lofzang moet bij het volgen beschikbaar zijn (de app haalt hem op via /api/hymns/<n>)
      const { loadResolvedHymn } = await import("../../src/lib/hymns/library/server");
      engine.registerHymn(loadResolvedHymn(number)!);
    }
    engine.startRecognizing();
  } else {
    engine.followHymn(number, "manual");
  }
  const { sampleRate, samples } = readWav(wavPath);
  const seconds = samples.length / sampleRate;
  let cpu = 0;
  let nextLog = 0;
  let firstFollow: number | null = null;
  let firstSuggest: number | null = null;
  const t0 = performance.now();
  for (let i = 0; i < samples.length; i += chunk) {
    const a = performance.now();
    engine.pushAudio(samples.subarray(i, Math.min(samples.length, i + chunk)), sampleRate, 8);
    // de UI-flush van de client: 100 ms klok, 8 ms budget per keer
    if (Math.floor(i / sampleRate / 0.1) !== Math.floor((i + chunk) / sampleRate / 0.1)) engine.drain(8);
    cpu += performance.now() - a;
    const t = i / sampleRate;
    const st = engine.state();
    if (st.stage === "following" && firstFollow === null && mode === "recognize") firstFollow = t;
    if (st.recognition?.suggestion && firstSuggest === null) firstSuggest = t;
    if (t >= nextLog) {
      nextLog += 20;
      const s = st.snapshot;
      console.log(
        `${t.toFixed(0).padStart(4)}s stage=${st.stage} backlog=${st.backlog} ` +
          (s ? `status=${s.status} pos=${s.position.toFixed(1)} lap=${s.lap} fase=${s.phase.phase} stanza=${s.stanza} regel=${s.cursor.section}:${s.cursor.line}/w${s.cursor.word} conf=${s.confidence.toFixed(2)}` : `herkenning=${st.recognition?.status ?? "-"} ${st.recognition?.suggestion ? "voorstel=" + st.recognition.suggestion.number : ""}`)
      );
    }
  }
  engine.drainAll();
  const st = engine.state();
  const s = st.snapshot;
  console.log(
    JSON.stringify({
      mode,
      audioSeconds: Math.round(seconds),
      cpuMs: Math.round(cpu),
      cpuMsPerAudioSecond: +(cpu / seconds).toFixed(2),
      endStage: st.stage,
      endStatus: s?.status ?? st.recognition?.status ?? null,
      endPosition: s ? +s.position.toFixed(1) : null,
      endLap: s?.lap ?? null,
      firstSuggestSeconds: firstSuggest,
      firstFollowSeconds: firstFollow,
      followedNumber: st.hymn?.number ?? null,
      wallMs: Math.round(performance.now() - t0),
    })
  );
}
main();
