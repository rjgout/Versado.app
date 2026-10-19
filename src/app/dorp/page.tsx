import ServerDorpClient from "@/components/dorp/ServerDorpClient";
import {dorpPageActor} from "@/lib/dorp/pageAccess";
export default async function DorpPage(){const user=await dorpPageActor();return <ServerDorpClient userId={user.id}/>;}
