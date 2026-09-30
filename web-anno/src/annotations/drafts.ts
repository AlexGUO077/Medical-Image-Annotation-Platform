import { annotationPayload, type Annotation } from './types';
export interface AnnotationDraft { baseVersion: number; annotations: Annotation[] }
/** Read after server authorization before writing. A conflicting local writer requires recovery, never overwrite. */
export interface DraftStore { read(): Promise<AnnotationDraft | undefined>; write(draft: AnnotationDraft): Promise<void>; remove(): Promise<void> }
const blocked = new Set<string>();
const generations = new Map<string, number>();
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open('miap-synthetic-annotation-drafts',1);
    let settled=false;
    request.onupgradeneeded = () => {
      const store=request.result.createObjectStore('drafts',{keyPath:['accountId','caseId']});store.createIndex('accountId','accountId');
      request.result.createObjectStore('accounts',{keyPath:'accountId'});
    };
    request.onerror = () => {settled=true;reject(request.error);};
    request.onblocked = () => {settled=true;reject(new Error('请关闭旧页面后重试草稿存储'));};
    request.onsuccess = () => {
      const db=request.result;if(settled){db.close();return;}
      db.onversionchange=()=>{db.close();opening=undefined;};resolve(db);
    };
  }).catch(error => {opening=undefined;throw error;});
  return opening;
}
async function transaction<T>(mode:IDBTransactionMode, operation:(store:IDBObjectStore, done:(value:T)=>void, fail:(error:unknown)=>void)=>void):Promise<T> {
  const db=await database();
  return new Promise<T>((resolve,reject)=>{
    const tx=db.transaction(['drafts','accounts'],mode);let result:T;
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('草稿存储已中断'));
    const fail=(error:unknown)=>{reject(error);tx.abort();};
    try {operation(tx.objectStore('drafts'),value=>{result=value;},fail);}catch(error){fail(error);}
  });
}
/** This claim selects a local partition only. Every remote operation still authorizes on the server. */
export function draftAccountId(token:string):string|undefined {
  try {
    const encoded=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const {sub}=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
    return typeof sub==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sub) ? sub.toLowerCase() : undefined;
  } catch {return undefined;}
}
export function allowAccountDrafts(accountId:string) {blocked.delete(accountId);}
export function syntheticDraftStore(accountId:string, caseId:string, source:string):DraftStore {
  if(source!=='synthetic')throw new Error('本地草稿仅支持合成病例');
  const generation=generations.get(accountId)??0;
  let initialized=false, epoch:string|undefined, revision:string|undefined;
  const scoped=<T>(mode:IDBTransactionMode, operation:(store:IDBObjectStore,done:(value:T)=>void,fail:(error:unknown)=>void)=>void)=>transaction<T>(mode,(store,done,fail)=>{
    if(blocked.has(accountId)||(generations.get(accountId)??0)!==generation)throw new Error('账号草稿已关闭');
    const account=store.transaction.objectStore('accounts').get(accountId);
    account.onsuccess=()=>{
      try {
        const current=account.result?.epoch as string|undefined;
        if(initialized&&current!==epoch)throw new Error('账号已在其他页面退出，请重新登录');
        if(!initialized&&mode==='readwrite')throw new Error('请先恢复草稿');
        epoch=current;operation(store,done,fail);
      }catch(error){fail(error);}
    };
  });
  const mutate=(draft?:AnnotationDraft)=>{
    const payload=draft?{baseVersion:draft.baseVersion,annotations:annotationPayload(draft.annotations)}:undefined;
    return scoped<string|undefined>('readwrite',(store,done,fail)=>{
      const request=store.get([accountId,caseId]);
      request.onsuccess=()=>{
        try {
          if(request.result?.revision!==revision)throw new Error('另一页面已修改本地草稿，请保留当前页面并处理冲突');
          const next=payload?crypto.randomUUID():undefined;
          if(payload)store.put({accountId,caseId,...payload,revision:next});else store.delete([accountId,caseId]);
          done(next);
        }catch(error){fail(error);}
      };
    }).then(next=>{revision=next;});
  };
  return {
    read:()=>scoped<AnnotationDraft|undefined>('readonly',(store,done,fail)=>{
      const request=store.get([accountId,caseId]);
      request.onsuccess=()=>{
        try {
          const row=request.result;
          if(row&&(!Number.isInteger(row.baseVersion)||row.baseVersion<0||typeof row.revision!=='string'))throw new Error('草稿版本无效');
          const draft=row?{baseVersion:row.baseVersion,annotations:annotationPayload(row.annotations)}:undefined;
          revision=row?.revision;initialized=true;done(draft);
        }catch(error){fail(error);}
      };
    }),
    write:draft=>mutate(draft),remove:()=>mutate(),
  };
}
export async function clearAccountDrafts(accountId:string):Promise<void> {
  // Immediate local gate plus an atomic shared epoch invalidates existing handles in other tabs.
  blocked.add(accountId);generations.set(accountId,(generations.get(accountId)??0)+1);
  await transaction<void>('readwrite',(store,done)=>{
    store.transaction.objectStore('accounts').put({accountId,epoch:crypto.randomUUID()});
    const cursor=store.index('accountId').openCursor(IDBKeyRange.only(accountId));
    cursor.onsuccess=()=>{if(cursor.result){cursor.result.delete();cursor.result.continue();}else done();};
  });
}
