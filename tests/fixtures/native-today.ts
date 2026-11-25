import type { NativeTodayOverview } from "../../src/lib/native/todayContract";
export function todayFixture(userId = "A", collection = "source-nl", version = 1): NativeTodayOverview {
 const now=Date.parse("2026-10-31T10:00:00Z");
 return { version:1,userId,activeCollectionId:collection,selectionVersion:version,language:"nl",companion:"novi",serverNow:now,expiresAt:"2026-10-31T23:00:00Z",countdownEnabled:false,kompasNew:true,program:null,avatars:{},
 continuation:{status:"ACTIVE",currentStreak:7,day:"2026-10-31",interruptedDay:null,completed:0,required:0,studiedToday:false},
 data:{firstName:userId,timeZone:"Europe/Amsterdam",partOfDay:"morning",streak:{current:7,studiedToday:false},actions:[],actionTotal:0,continueItems:[{key:"course-alma",visibilityKey:"course-alma:v1",kind:"course",title:"Verder met Alma",position:"Alma 32:1–10",positionSeconds:null,progress:{done:30,total:100,unitPlural:"stappen"},href:"/reading-lesson/real-step",context:"Stap voor stap",at:"2026-10-31T09:00:00Z",artwork:[]}],dailyText:{href:"/lesson/alma",reference:"Alma 32:1",sourceName:"Schriften",bookName:"Alma",chapterNumber:32,verseNumber:1,text:"Een synthetische, selecteerbare dagelijkse schrifttekst."},sundayHymns:false,wordGame:{href:"/word-game",status:"done",won:true,dayKey:"2026-10-31",nextReleaseAt:"2026-10-31T17:00:00Z"},dailyQuiz:{href:"/alleskenner/alleen",status:"todo"},social:{friends:[],online:{},viewerSharesOnline:false},together:null,discover:[{key:"course-next",kind:"course",title:"Ontdek de Schriften",description:null,href:"/courses",meta:null,artwork:[]}]},
 };
}
