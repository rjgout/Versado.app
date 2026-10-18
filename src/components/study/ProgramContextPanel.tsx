import {getStudyCatalogue} from '@/lib/studyContent/catalogue';
import ProgramLessonPicker from './ProgramLessonPicker';
import LiveRefresh from '@/components/LiveRefresh';
export default async function ProgramContextPanel({actor}:{actor:{id:string;isAdmin:boolean}}){
 const data=await getStudyCatalogue(actor);
 if(!data.context)return null;
 return <div className="min-w-0"><LiveRefresh scopes={['studyContext','studyContent','content','progress']} token={data.token}/><ProgramLessonPicker key={`${actor.id}:${data.context.workKey}:${data.collectionId}`} data={data}/></div>;
}
