import { AnnotationRequestError } from './api';
import type { AnnotationDraft, DraftStore } from './drafts';
import { annotationPayload, type Annotation, type AnnotationRead, type AnnotationVersion } from './types';
export type SaveStatus = 'loading'|'saved'|'dirty'|'saving'|'offline'|'conflict'|'blocked'|'error';
export interface SaveState {
  status:SaveStatus; version:number; annotations:Annotation[]; dirty:boolean;
  error?:string; storageError?:string; savedAt?:number; server?:AnnotationRead;
}
export interface SaveTransport {
  read(signal:AbortSignal):Promise<AnnotationRead>;
  save(version:number, annotations:Annotation[], signal:AbortSignal):Promise<AnnotationVersion>;
}
/** One case/session instance. Persistence contains annotations only; bearer credentials stay in its transport closure. */
export class AnnotationSaveSession {
  private state:SaveState={status:'loading',version:0,annotations:[],dirty:false};
  private controller=new AbortController();
  private timer?:ReturnType<typeof setTimeout>;
  private pending?:Promise<void>;
  private persistence:Promise<void>=Promise.resolve();
  private revision=0;
  private due=0;
  private online=true;
  private loaded=false;
  private disposed=false;
  private checking=false;
  private immediate=false;
  constructor(private transport:SaveTransport,private store:DraftStore,private notify:(state:SaveState)=>void) {}
  snapshot():SaveState {return structuredClone(this.state);}
  private publish() {if(!this.disposed)this.notify(this.snapshot());}
  private cancelTimer(){clearTimeout(this.timer);this.timer=undefined;}
  private persist(draft?:AnnotationDraft) {
    this.persistence=this.persistence.then(()=>draft?this.store.write(draft):this.store.remove()).then(()=>{this.state.storageError=undefined;this.publish();},()=>{this.state.storageError='本地草稿存储失败，请保持页面打开并重试保存';this.publish();});
  }
  private keepDraft(){this.persist({baseVersion:this.state.version,annotations:annotationPayload(this.state.annotations)});}
  private fail(error:unknown) {
    const code=error instanceof AnnotationRequestError?error.status:0;
    this.state.status=code===401||code===403?'blocked':code===409?'conflict':!this.online?'offline':'error';
    this.state.error=error instanceof Error?error.message:'保存失败';this.cancelTimer();this.publish();
  }
  async start():Promise<void> {
    if(this.loaded||this.checking||this.disposed)return;
    this.checking=true;
    try {
      // Do not expose a persisted case draft until current account/assignment checks succeed.
      const server=await this.transport.read(this.controller.signal);
      let draft:AnnotationDraft|undefined;
      try{draft=await this.store.read();}catch{this.state.storageError='本地草稿读取失败，暂不能编辑以免覆盖未恢复草稿';throw new Error(this.state.storageError);}
      if(this.disposed)return;
      this.loaded=true;this.state.version=server.current_version;
      if(draft){
        this.state.annotations=annotationPayload(draft.annotations);this.state.version=draft.baseVersion;this.state.dirty=true;
        this.state.status=draft.baseVersion===server.current_version?'dirty':'conflict';
        if(this.state.status==='conflict')this.state.server=server;
        this.due=Date.now()+2000;
      }else{this.state.annotations=annotationPayload(server.annotations);this.state.status='saved';}
      if(!this.online&&this.state.status!=='conflict')this.state.status='offline';
    }catch(error){if(!this.disposed)this.fail(error);}finally{this.checking=false;this.publish();this.schedule();}
  }
  change(annotations:readonly Annotation[]):void {
    if(!this.loaded||this.disposed||this.checking||this.state.status==='blocked')return;
    this.state.annotations=annotationPayload(annotations);this.state.dirty=true;this.revision++;this.due=Date.now()+2000;
    if(!['conflict','error','saving'].includes(this.state.status))this.state.status=this.online?'dirty':'offline';
    this.keepDraft();this.publish();this.schedule();
  }
  private schedule(){
    this.cancelTimer();
    if(this.disposed||!this.loaded||this.checking||this.pending||!this.online||!this.state.dirty||['conflict','blocked','error'].includes(this.state.status))return;
    this.timer=setTimeout(()=>{void this.runSave();},Math.max(0,this.due-Date.now()));
  }
  private runSave():Promise<void> {
    if(this.pending)return this.pending;
    if(this.disposed||this.checking||!this.loaded||!this.online||!this.state.dirty||['conflict','blocked','error'].includes(this.state.status))return Promise.resolve();
    this.cancelTimer();
    const revision=this.revision,version=this.state.version,annotations=annotationPayload(this.state.annotations);
    this.state.status='saving';this.publish();
    this.pending=(async()=>{
      try {
        const result=await this.transport.save(version,annotations,this.controller.signal);
        if(this.disposed)return;
        this.state.version=result.version;this.state.error=undefined;this.state.savedAt=Date.now();
        if(this.revision===revision){this.state.annotations=annotationPayload(result.annotations);this.state.dirty=false;this.persist();}
        else this.keepDraft();
        this.state.status=!this.online?'offline':this.state.dirty?'dirty':'saved';
      }catch(error){if(!this.disposed)this.fail(error);}
    })().finally(()=>{this.pending=undefined;if(this.immediate)this.due=Date.now();this.publish();this.schedule();});
    return this.pending;
  }
  async saveNow():Promise<void> {
    this.immediate=true;
    try{
      this.due=Date.now();this.cancelTimer();
      while(!this.disposed&&this.online&&this.state.dirty&&!this.checking&&!['conflict','blocked','error'].includes(this.state.status))await this.runSave();
      await this.persistence;
    }finally{this.immediate=false;}
  }
  setOnline(online:boolean):void {
    this.online=online;this.cancelTimer();
    if(!online){if(!['blocked','conflict'].includes(this.state.status))this.state.status='offline';this.publish();}
    else void this.recover();
  }
  /** Retry reads first: a lost response may have committed, and permissions may have changed. */
  async recover():Promise<void> {
    if(this.disposed||this.checking||!this.online)return;
    if(!this.loaded){await this.start();return;}
    this.checking=true;this.cancelTimer();
    try {
      await this.pending;
      if(this.disposed)return;
      const server=await this.transport.read(this.controller.signal);
      if(this.disposed)return;
      if(this.state.dirty&&server.current_version!==this.state.version){this.state.status='conflict';this.state.server=server;}
      else {
        if(!this.state.dirty){this.state.version=server.current_version;this.state.annotations=annotationPayload(server.annotations);}
        this.state.status=this.online?(this.state.dirty?'dirty':'saved'):'offline';this.state.error=undefined;this.due=Date.now()+2000;
      }
    }catch(error){if(!this.disposed)this.fail(error);}finally{this.checking=false;this.publish();this.schedule();}
  }
  /** Explicit discard only; always fetch again rather than trusting an earlier conflict preview. */
  async useServer():Promise<void> {
    if(this.disposed||this.checking||!this.online)return;
    this.checking=true;this.cancelTimer();
    try{
      await this.pending;
      if(this.disposed)return;
      const server=await this.transport.read(this.controller.signal);
      if(this.disposed)return;
      this.state={status:this.online?'saved':'offline',version:server.current_version,annotations:annotationPayload(server.annotations),dirty:false};
      this.persist();
    }catch(error){if(!this.disposed)this.fail(error);}finally{this.checking=false;this.publish();}
  }
  async dispose():Promise<void> {
    this.disposed=true;this.cancelTimer();this.controller.abort();
    // Edits were queued synchronously, so navigation need not start an unload-time request.
    await this.persistence;
  }
}
