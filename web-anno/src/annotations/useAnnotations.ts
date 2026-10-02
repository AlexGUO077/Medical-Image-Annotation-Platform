import { useEffect,useRef,useState } from 'react';
import { annotationsApi,AnnotationRequestError } from './api';
import { draftAccountId,syntheticDraftStore } from './drafts';
import { AnnotationSaveSession,type SaveState } from './save-session';
import type { Session } from '../auth/types';
import type { ReviewRecord } from '../reviews/types';
const empty:SaveState={initialized:false,checking:true,status:'loading',version:0,annotations:[],dirty:false};
export function useAnnotations(auth:Session,caseId:string,source:string,onExpired?:()=>void){
 const [latestReview,setLatestReview]=useState<ReviewRecord|null>();
 const [state,setState]=useState<SaveState>(empty),active=useRef<AnnotationSaveSession>(),expired=useRef(onExpired);expired.current=onExpired;
 useEffect(()=>{
  let mounted=true;setState(empty);setLatestReview(undefined);const account=draftAccountId(auth.token);
  if(!account||source!=='synthetic'){setState({...empty,checking:false,status:'blocked',error:'当前会话或病例不支持标注草稿'});return;}
  const guarded=async<T,>(work:Promise<T>)=>{try{return await work;}catch(error){if(error instanceof AnnotationRequestError&&error.status===401&&mounted){await active.current?.dispose();expired.current?.();}throw error;}};
  const engine=new AnnotationSaveSession({read:async signal=>{const value=await guarded(annotationsApi.read(caseId,auth.token,signal));if(mounted)setLatestReview(value.latest_review??null);return value;},save:(version,annotations,signal)=>guarded(annotationsApi.save(caseId,auth.token,signal,version,annotations))},syntheticDraftStore(account,caseId,source),value=>{if(mounted)setState(value);});
  active.current=engine;void engine.start();
  const online=()=>engine.setOnline(navigator.onLine),unload=(event:BeforeUnloadEvent)=>{if(engine.snapshot().dirty){event.preventDefault();event.returnValue='';}};
  if(!navigator.onLine)engine.setOnline(false);
  window.addEventListener('online',online);window.addEventListener('offline',online);window.addEventListener('beforeunload',unload);
  return()=>{mounted=false;window.removeEventListener('online',online);window.removeEventListener('offline',online);window.removeEventListener('beforeunload',unload);void engine.dispose();active.current=undefined;};
 },[auth.token,caseId,source]);
 return {state,latestReview,engine:active,editable:state.initialized&&!state.checking&&!['loading','blocked'].includes(state.status)};
}
