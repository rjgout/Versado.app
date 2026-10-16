// Uitsluitend de bestaande localhost-wegwerpdatabase; hashes, geen productiegegevens.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
const raw=process.env.CONTENT_ACCESS_TEST_DATABASE_URL, url=new URL(raw??"http://invalid");
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_content_access_test"||process.env.DATABASE_URL!==raw)throw Error("Eigen testdatabase vereist");
const db=new pg.Client({connectionString:raw});await db.connect();
const file=process.env.CONTENT_MIGRATION_TEST_STATE+'.annotations';
const sql=readFileSync('prisma/migrations/20261104120000_annotation_targets/migration.sql','utf8');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
async function hash(table,columns){return(await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM (SELECT ${columns.map(quote).join(',')} FROM ${quote(table)}) t`)).rows[0].hash;}
try {
 if(process.argv[2]==='prepare'){
  const user=(await db.query('SELECT id FROM "User" LIMIT 1')).rows[0].id;
  const chapter=(await db.query('SELECT id FROM "Chapter" LIMIT 1')).rows[0].id;
  const verse='annotation-migration-'+randomUUID();
  await db.query('INSERT INTO "Verse" (id,"chapterId",number,text) VALUES ($1,$2,987654,$3)',[verse,chapter,'Eigen migratiefixture']);
  for(const model of ['Bookmark','Highlight','Note']){
   const extra=model==='Note'?',text,"updatedAt"':model==='Highlight'?',color':'';
   const value=model==='Note'?",'Synthetische privénotitie é 日本語','2020-04-05 06:07:08.123'":model==='Highlight'?",'blue'":'';
   await db.query(`INSERT INTO "${model}" (id,"userId","verseId","createdAt"${extra}) VALUES ($1,$2,$3,'2019-01-02 03:04:05.678'${value})`,['migration-'+model,user,verse]);
  }
  const rows=(await db.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`)).rows;
  const tables={};for(const r of rows)(tables[r.table_name]??=[]).push(r.column_name);
  const snapshots=[];for(const [table,columns] of Object.entries(tables))snapshots.push({table,columns,hash:await hash(table,columns)});
  // Naamconflict na eerdere ALTER/UPDATE-statements moet de hele migratie terugrollen.
  await assert.rejects(db.query(sql.replace('CREATE UNIQUE INDEX "Note_userId_targetKey_key"','CREATE UNIQUE INDEX "Note_userId_verseId_key"')),e=>e.code==='42P07');
  await db.query('ROLLBACK');
  for(const s of snapshots)assert.equal(await hash(s.table,s.columns),s.hash);
  assert.equal((await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Bookmark' AND column_name='lessonEditionId'`)).rows[0].n,0);
  writeFileSync(file,JSON.stringify({snapshots,user,verse}),{mode:0o600});
 } else {
  const {snapshots,user,verse}=JSON.parse(readFileSync(file,'utf8'));
  for(const s of snapshots)assert.equal(await hash(s.table,s.columns),s.hash,s.table+': alle oorspronkelijke kolommen behouden');
  for(const model of ['Bookmark','Highlight','Note']){
   const row=(await db.query(`SELECT * FROM "${model}" WHERE id=$1`,['migration-'+model])).rows[0];
   assert.equal(row.targetKey,'verse:'+verse);assert.equal(row.mutationVersion,0);assert.equal(row.anchorStatus,'EXACT');assert.equal(row.deletedAt,null);
   await assert.rejects(db.query(`INSERT INTO "${model}" (id,"userId","verseId"${model==='Note'?',text,"updatedAt"':''}) VALUES ('duplicate',$1,$2${model==='Note'?",'x',now()":''})`,[user,verse]),e=>e.code==='23505');
   await assert.rejects(db.query(`UPDATE "${model}" SET "lessonEditionId"='unknown' WHERE id=$1`,['migration-'+model]));
   await assert.rejects(db.query(`UPDATE "${model}" SET "verseId"=NULL WHERE id=$1`,['migration-'+model]),e=>e.code==='23514');
   await assert.rejects(db.query(`UPDATE "${model}" SET "verseId"='missing' WHERE id=$1`,['migration-'+model]));
  }
  await assert.rejects(db.query('DELETE FROM "Verse" WHERE id=$1',[verse]),e=>e.code==='23503');
  assert.equal((await db.query('SELECT count(*)::int n FROM "Verse" WHERE id=$1',[verse])).rows[0].n,1);
  for(const s of snapshots)assert.equal(await hash(s.table,s.columns),s.hash);
  console.log(JSON.stringify({annotationMigration:'passed',preservedTables:snapshots.length,oldRowsAndTimestampsIdentical:true,verseDeletionRestricted:true,uniqueAndXorPreserved:true,conflictingMigrationAtomic:true,productionTouched:false}));
 }
}finally{await db.end();}
