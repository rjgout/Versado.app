import ReaderBackTarget from "@/components/ReaderBackTarget";
import CourseBackTarget from "@/components/CourseBackTarget";
import {isValidElement,Fragment,Children,Suspense,type ReactNode} from "react";
import type {User} from "@/generated/prisma/client";
import type {NextRequest} from "next/server";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import FocusLayout from "@/components/versado/FocusLayout";
import MysteryDetailPage from "@/components/mysteries/MysteryDetailPage";
import MysteryPlayPage from "@/components/mysteries/MysteryPlayPage";
import {withNativeGameIdentity} from "@/lib/games/requestIdentity.server";
import {NativeGameRedirect,NativeGameNotFound} from "@/lib/games/navigation.server";
import {getContentPickerContext} from "@/lib/contentCollections";
import {applicationOrigin} from "@/lib/baseUrl";
import {NativeAuthError} from "./sessions";
import {GAME_PAGE_LOADERS} from "./gamesPages.server";
import {gamePageRoute} from "./gamesPagesRoutes";
import {encodeGameProps,nativeGamePageSchema,nativeGameScreen,type NativeGameScreen} from "./gamesPageContract";

/** Alleen vaste gedeelde spelcomponenten en bekende presentatiewrappers.
 * React wordt hier niet gerenderd; HTML, scripts en vrije componentnamen ontbreken in het protocol. */
async function project(node:ReactNode|void,frame:NativeGameScreen["frame"]="plain",depth=0):Promise<NativeGameScreen> {
  if(depth>8||!isValidElement<Record<string,unknown>>(node))throw new NativeAuthError("invalid_response",502);
  if(node.type===Fragment){
    const children=Children.toArray(node.props.children as ReactNode).filter(child=>isValidElement(child)&&child.type!==ReaderBackTarget&&child.type!==CourseBackTarget);
    if(children.length!==1)throw new NativeAuthError("invalid_response",502);
    const screen=await project(children[0],frame,depth+1);
    const back=Children.toArray(node.props.children as ReactNode).find(child=>isValidElement(child)&&(child.type===ReaderBackTarget||child.type===CourseBackTarget));
    if(isValidElement<Record<string,unknown>>(back))return nativeGameScreen.parse({...screen,back:{href:back.props.href,parent:back.props.parent,soft:back.props.soft===true}});
    return screen;
  }
  if(node.type===GameScreen)return nativeGameScreen.parse({view:node.props.view,data:encodeGameProps(node.props.data),frame});
  if(node.type===WebGameBoundary||node.type===Suspense)return project(node.props.children as ReactNode,frame,depth+1);
  if(node.type===FocusLayout){if(node.props.className!=="max-w-5xl")throw new NativeAuthError("invalid_response",502);return project(node.props.children as ReactNode,"focus",depth+1);}
  if(node.type==="div"&&node.props.className==="min-w-0 space-y-6")return project(node.props.children as ReactNode,"hub",depth+1);
  // Deze twee bestaande servercomponenten delen al alle 18 mysterieniveaus.
  if(node.type===MysteryDetailPage)return project(await MysteryDetailPage(node.props as unknown as Parameters<typeof MysteryDetailPage>[0]),frame,depth+1);
  if(node.type===MysteryPlayPage)return project(await MysteryPlayPage(node.props as unknown as Parameters<typeof MysteryPlayPage>[0]),frame,depth+1);
  throw new NativeAuthError("invalid_response",502);
}
export async function nativeGamePage(req:NextRequest,user:User,verify:()=>Promise<User>) {
  if(req.method!=="GET"||[...req.nextUrl.searchParams.keys()].length!==1||!req.nextUrl.searchParams.has("route"))throw new NativeAuthError("invalid_input",400);
  const route=gamePageRoute(req.nextUrl.searchParams.get("route")??"");
  if(!route)throw new NativeAuthError("endpoint_unavailable",404);
  const picker=await getContentPickerContext(user.id);
  if(user.contentSelectionVersion!==picker.selectionVersion)throw new NativeAuthError("content_context_changed",409);
  let result;
  try{
    const screen=await withNativeGameIdentity(verify,async()=>project(await GAME_PAGE_LOADERS[route.id](route.params,route.query)),req.headers.get("origin")??undefined);
    result={kind:"screen" as const,screen};
  }catch(error){
    if(error instanceof NativeGameRedirect){const href=["/login","/dashboard","/courses","/content"].includes(error.href)?error.href:gamePageRoute(error.href)?.href;if(!href)throw new NativeAuthError("invalid_response",502);result={kind:"redirect" as const,href};}
    else if(error instanceof NativeGameNotFound)throw new NativeAuthError("content_unavailable",404);
    else throw error;
  }
  const latest=await verify(),latestPicker=await getContentPickerContext(latest.id);
  if(latest.id!==user.id||latest.uiLanguage!==user.uiLanguage||latest.isAdmin!==user.isAdmin||latest.contentSelectionVersion!==user.contentSelectionVersion||latestPicker.activeCollectionId!==picker.activeCollectionId)throw new NativeAuthError("content_context_changed",409);
  return nativeGamePageSchema.parse({version:1,userId:user.id,activeCollectionId:picker.activeCollectionId,selectionVersion:picker.selectionVersion,language:user.uiLanguage,path:route.href,shareOrigin:applicationOrigin(),result});
}
