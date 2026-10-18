import test from 'node:test';
import assert from 'node:assert/strict';
import type {FsyLesson} from '../src/generated/prisma/client';
import {fsyLegacyIdentity,fsyConversionActionSchema} from '../src/lib/studyContent/fsyConversion';
const row={id:'legacy-a',title:'Exacte tekst é',content:'[]',publishedContent:'[{"type":"paragraph","text":"Oude kopie"}]',sourceHash:'original-hash',publishedAt:new Date('2024-01-02T03:04:05.678Z'),lastScrapedAt:new Date('2025-01-02T03:04:05.678Z'),studyLessonEditionId:null} as FsyLesson;
test('legacy-identiteit bewaart timestamps, bronhash en beide kopieën; mapping is geen tekstwijziging',()=>{
 const hash=fsyLegacyIdentity(row);assert.equal(hash,fsyLegacyIdentity({...row,studyLessonEditionId:'new-edition'}));
 for(const patch of [{publishedAt:new Date('2024-01-02T03:04:05.679Z')},{sourceHash:'changed'},{content:'changed'},{publishedContent:'changed'}])assert.notEqual(hash,fsyLegacyIdentity({...row,...patch}));
 assert.equal(hash,fsyLegacyIdentity(JSON.parse(JSON.stringify(row))));
});
test('expliciete actie bindt snapshot, UUID en bevestiging; onbekende velden worden geweigerd',()=>{
 const request={expectedLegacyHash:fsyLegacyIdentity(row),actionId:'123e4567-e89b-42d3-a456-426614174000',confirm:'CONVERT_EXISTING_FSY'};
 assert.equal(fsyConversionActionSchema.safeParse(request).success,true);
 for(const patch of [{confirm:'yes'},{expectedLegacyHash:''},{actionId:'not-a-uuid'},{autoPublish:true}])assert.equal(fsyConversionActionSchema.safeParse({...request,...patch}).success,false);
});
