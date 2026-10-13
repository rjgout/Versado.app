import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { MYSTERY_GAME } from "../src/lib/mysteries/game";
import { emptyClueNotes, validMysteryBoard, mysteryActionSchema } from "../src/lib/mysteries/attemptContract";
import { parseBoardManifest } from "../src/lib/mysteries/manifest";
import { isSolutionCorrect, satisfiesPuzzleClues, hintFor } from "../src/lib/mysteries/logic";
import { closingQuestionFor } from "../src/lib/mysteries/closingQuestions";

test("alle 18 vaste varianten: assets, geometry, oplossing, clues, hints en slotvraag", () => {
  assert.equal(MYSTERY_GAME.puzzles.length,18); assert.equal(new Set(MYSTERY_GAME.puzzles.map(d=>d.routeId)).size,18);
  for (const d of MYSTERY_GAME.puzzles) {
    const geometry = parseBoardManifest(JSON.parse(readFileSync(`public${d.assets.manifest}`,"utf8")));
    assert.ok(geometry); assert.equal(geometry.rows,d.grid.rows); assert.equal(geometry.columns,d.grid.columns);
    assert.ok(existsSync(`public${d.assets.board}`)); for(const c of d.characters) assert.ok(existsSync(`public${c.asset}`));
    assert.ok(validMysteryBoard(d,{placements:d.solution,clueNotes:emptyClueNotes(d)}));
    assert.ok(isSolutionCorrect(d,d.solution)); assert.ok(satisfiesPuzzleClues(d,d.solution));
    assert.ok(hintFor(d,{})); assert.ok(closingQuestionFor(d).questionKey); assert.equal(d.story.source.work,"bofm");
    assert.equal(validMysteryBoard(d,{placements:{intruder:{row:1,column:1}},clueNotes:{}}),false);
    assert.equal(validMysteryBoard(d,{placements:{[d.characters[0].id]:{row:999,column:1}},clueNotes:{}}),false);
    assert.equal(validMysteryBoard(d,{placements:{[d.characters[0].id]:{row:1,column:1},[d.characters[1].id]:{row:1,column:1}},clueNotes:{}}),false);
    assert.equal(validMysteryBoard(d,{placements:{},clueNotes:{fake:true}}),false);
  }
});
test("client kan geen bron, eigenaar, hintCount of ontbrekende revisie als autoriteit meesturen",()=>{
  assert.equal(mysteryActionSchema.safeParse({action:"hint",attemptId:"x",actionId:crypto.randomUUID(),expectedRevision:0,hintCount:0}).success,false);
  assert.equal(mysteryActionSchema.safeParse({action:"start",variant:"001a",actionId:crypto.randomUUID(),contentCollectionId:"content_bom"}).success,false);
  assert.equal(mysteryActionSchema.safeParse({action:"save",attemptId:"x",userId:"another",placements:{},clueNotes:{}}).success,false);
});
