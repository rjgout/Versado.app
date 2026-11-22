// Echte native dispatch, oorspronkelijke backendhandlers en eigen wegwerpdatabase.
import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {issueNativeSession} from '../src/lib/native/sessions.ts';
import {createSessionToken} from '../src/lib/auth.ts';
import {seedNativeCourses} from './fixtures/native-courses.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid'),base=process.env.NATIVE_TEST_BASE_URL;
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL||!base||new URL(base).hostname!=='127.0.0.1')throw Error('Alleen eigen geïsoleerde cursusdatabase');
let fixture,a,b,added,initialSource;const owners=[];
async function account(){const user=await fixture.account();owners.push(user.id);return {user,tokens:await issueNativeSession(user.id,user.sessionVersion),cookie:await createSessionToken(user.id)};}
async function native(path,{actor=a,method='GET',body,cookie,origin='capacitor://localhost'}={}){
 const response=await fetch(base+'/api/v1/native/'+path,{method,headers:{Origin:origin,'X-Versado-Client':'native-v1',...(actor?{Authorization:'Bearer '+actor.tokens.accessToken}:{}),...(cookie?{Cookie:'bvm_session='+cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const text=await response.text();return {response,data:text?JSON.parse(text):null};
}
const order=()=>native('games/list-order?listKey=courses');
const save=ids=>native('games/list-order',{method:'PUT',body:{listKey:'courses',itemKeys:ids},cookie:b.cookie});
const progress=()=>prisma.contentProgress.findMany({where:{userId:a.user.id},orderBy:{id:'asc'}});
const ownRows=()=>prisma.userListOrder.findMany({where:{userId:{in:owners}},orderBy:[{userId:'asc'},{listKey:'asc'},{order:'asc'}]});
async function sourceState(){return {
 courses:await prisma.course.findMany({where:{id:{in:fixture.courses.map(course=>course.id)}},orderBy:{id:'asc'},include:{lessons:{orderBy:{id:'asc'}},chapters:{orderBy:{id:'asc'}}}}),
 chapters:await prisma.chapter.findMany({where:{bookId:fixture.book.id},orderBy:{id:'asc'},include:{verses:{orderBy:{id:'asc'}}}})
};}
before(async()=>{fixture=await seedNativeCourses();a=await account();b=await account();added=fixture.courses.find(course=>course.type==='FREE_CHOICE');initialSource=await sourceState();});
after(async()=>{await prisma.user.deleteMany({where:{id:{in:owners}}});await prisma.contentCollection.delete({where:{id:fixture.collection.id}});await prisma.$disconnect();});
test('native cursusvolgorde ophalen en eerder/later opslaan blijft eigenaargebonden en gelijk aan web',async()=>{
 const initial=await progress(),ids=fixture.courses.map(course=>course.id);
 assert.equal((await order()).response.status,200);
 await prisma.userListOrder.create({data:{userId:b.user.id,listKey:'courses',itemKey:'alleen-van-B',order:0}});
 for(const next of [[ids[0],ids[2],ids[1]],ids]){
  const saved=await save(next);assert.equal(saved.response.status,200);assert.equal(saved.data.status,200,JSON.stringify(saved.data));assert.deepEqual((await order()).data.data.order,next);
  const list=await native('courses');assert.equal(list.response.status,200);assert.deepEqual(list.data.courses.map(course=>course.id),next);
 }
 const web=await fetch(base+'/api/list-order?listKey=courses',{headers:{Cookie:'bvm_session='+a.cookie}});assert.equal(web.status,200);assert.deepEqual((await web.json()).order,ids);
 const reversed=[ids[0],ids[2],ids[1]],write=await fetch(base+'/api/list-order',{method:'PUT',headers:{Origin:base,Cookie:'bvm_session='+a.cookie,'Content-Type':'application/json'},body:JSON.stringify({listKey:'courses',itemKeys:reversed})});assert.equal(write.status,200);assert.deepEqual((await order()).data.data.order,reversed);
 assert.deepEqual(await progress(),initial);
 const other=await native('games/list-order?listKey=courses',{actor:b,cookie:a.cookie});assert.deepEqual(other.data.data.order,['alleen-van-B']);
});
test('verbergen, terugzetten en toevoegen behouden cursuscursor en alle leesvoortgang',async()=>{
 const initial=await progress(),course=fixture.steps,cursor=await prisma.userCourseProgress.findUniqueOrThrow({where:{userId_courseId:{userId:a.user.id,courseId:course.id}}});
 const hidden=await native(`games/courses/${course.id}/unsubscribe`,{method:'POST',body:{}});assert.equal(hidden.data.status,200);
 const afterHide=await prisma.userCourseProgress.findUniqueOrThrow({where:{userId_courseId:{userId:a.user.id,courseId:course.id}}});assert.deepEqual(afterHide,{...cursor,subscribed:false});
 assert.equal((await native('courses')).data.courses.some(row=>row.id===course.id),false);
 const restored=await native(`games/courses/${course.id}/subscribe`,{method:'POST',body:{}});assert.equal(restored.data.status,200);
 assert.deepEqual(await prisma.userCourseProgress.findUniqueOrThrow({where:{userId_courseId:{userId:a.user.id,courseId:course.id}}}),cursor);
 // Alleen eigen fixture: deze canonieke cursus heeft voor A nog geen abonnement.
 await prisma.userCourseProgress.delete({where:{userId_courseId:{userId:a.user.id,courseId:added.id}}});
 assert.equal((await save(fixture.courses.filter(row=>row.id!==added.id).map(row=>row.id))).data.status,200);
 const subscribed=await native(`games/courses/${added.id}/subscribe`,{method:'POST',body:{}});assert.equal(subscribed.data.status,200);
 const ids=[...fixture.courses.filter(row=>row.id!==added.id).map(row=>row.id),added.id];assert.equal((await save(ids)).data.status,200);assert.deepEqual((await order()).data.data.order,ids);
 assert.ok((await native('courses')).data.courses.some(row=>row.id===added.id));assert.deepEqual(await progress(),initial);
});
test('native cursusvoorkeuren behouden methode-, query-, invoer-, origin- en sessiegrenzen',async()=>{
 const before=await ownRows();
 for(const path of ['games/list-order','games/list-order?listKey=today-continue','games/list-order?listKey=other','games/list-order?listKey=courses&listKey=games','games/list-order?listKey=courses&userId=B'])assert.equal((await native(path)).response.status,404,path);
 for(const method of ['POST','PATCH','DELETE'])assert.equal((await native('games/list-order',{method,body:{listKey:'courses',itemKeys:[]}})).response.status,404,method);
 assert.equal((await native('games/list-order?listKey=courses',{method:'PUT',body:{listKey:'courses',itemKeys:[]}})).response.status,404);
 for(const body of [{listKey:'today-continue',itemKeys:[]},{listKey:'other',itemKeys:[]}])assert.equal((await native('games/list-order',{method:'PUT',body})).response.status,400);
 for(const body of [{listKey:'courses'},{listKey:'courses',itemKeys:[1]},{listKey:'courses',itemKeys:[],userId:b.user.id}])assert.equal((await native('games/list-order',{method:'PUT',body})).data.status,400);
 assert.equal((await native('games/list-order?listKey=courses',{actor:null,cookie:a.cookie})).response.status,401);
 assert.equal((await native('games/list-order?listKey=courses',{origin:'https://foreign.invalid'})).response.status,403);
 assert.deepEqual(await ownRows(),before);
 const expired=await account();await prisma.nativeSession.updateMany({where:{userId:expired.user.id},data:{revokedAt:new Date()}});assert.equal((await native('games/list-order?listKey=courses',{actor:expired})).response.status,401);assert.equal((await native('games/list-order',{actor:expired,method:'PUT',body:{listKey:'courses',itemKeys:[]}})).response.status,401);
});

test('echte native herlogin behoudt cursusvolgorde, abonnementen, voortgang en volledige broninhoud',async()=>{
 const expected=(await order()).data.data.order,reading=await progress();
 const subscriptions=()=>prisma.userCourseProgress.findMany({where:{userId:a.user.id},orderBy:{id:'asc'}});
 const before=await subscriptions();
 async function login(){
  const result=await native('login',{actor:null,method:'POST',body:{identifier:a.user.email,password:fixture.password}});
  assert.equal(result.response.status,200);assert.ok(result.data.accessToken&&result.data.refreshToken);
  return {...a,tokens:result.data};
 }
 const first=await login();
 assert.deepEqual((await native('games/list-order?listKey=courses',{actor:first})).data.data.order,expected);
 const loggedOut=await native('logout',{actor:null,method:'POST',body:{refreshToken:first.tokens.refreshToken,actionId:randomUUID()}});
 assert.equal(loggedOut.response.status,200);assert.equal(loggedOut.data.ok,true);
 assert.equal((await native('games/list-order?listKey=courses',{actor:first})).response.status,401);
 assert.equal((await native('games/list-order',{actor:first,method:'PUT',body:{listKey:'courses',itemKeys:[]}})).response.status,401);
 const second=await login();assert.ok(first.tokens.accessToken!==second.tokens.accessToken,'Herlogin krijgt een nieuwe eigen sessie');
 assert.deepEqual((await native('games/list-order?listKey=courses',{actor:second})).data.data.order,expected);
 const moved=[expected[0],...expected.slice(1).reverse()];
 for(const itemKeys of [moved,expected]){
  const saved=await native('games/list-order',{actor:second,method:'PUT',body:{listKey:'courses',itemKeys}});
  assert.equal(saved.response.status,200);assert.equal(saved.data.status,200);
  assert.deepEqual((await native('games/list-order?listKey=courses',{actor:second})).data.data.order,itemKeys);
  assert.deepEqual((await native('courses',{actor:second})).data.courses.map(course=>course.id),itemKeys);
 }
 assert.deepEqual(await subscriptions(),before);assert.deepEqual(await progress(),reading);
 assert.deepEqual(await sourceState(),initialSource,'Alle cursusdefinities, lessen, hoofdstukken en verzen blijven byte-identiek');
});
