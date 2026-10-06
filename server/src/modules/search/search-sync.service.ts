import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { ElasticService, type SearchDocument } from './elastic.service';
import { publishedPredicate, reportJoin, revisionKey } from './published-case';
import { searchEvents } from './search-events';
@Injectable()
export class SearchSyncService implements OnApplicationBootstrap,OnModuleDestroy {
 private readonly logger=new Logger(SearchSyncService.name);
 private readonly pending=new Set<string>();
 private stopped=false;private timer?:ReturnType<typeof setTimeout>;private running?:Promise<void>;private nextFull=0;
 constructor(@Inject(DATABASE_SOURCE)private readonly db:DataSource,private readonly elastic:ElasticService){}
 private readonly enqueue=(id:string)=>{this.pending.add(id);void this.runOnce().catch(()=>this.logger.error('Search synchronization failed; retry scheduled'));};
 onApplicationBootstrap():void {searchEvents.on('case',this.enqueue);void this.loop();}
 async onModuleDestroy():Promise<void>{this.stopped=true;searchEvents.off('case',this.enqueue);if(this.timer)clearTimeout(this.timer);await this.running?.catch(()=>undefined);}
 runOnce(full=false):Promise<void>{
  if(full)this.nextFull=0;
  if(this.stopped)return Promise.resolve();
  return this.running??=(async()=>{
   await this.elastic.ensure();
   if(Date.now()>=this.nextFull){await this.reconcile();this.nextFull=Date.now()+24*60*60*1000;}
   for(const id of [...this.pending]){this.pending.delete(id);try{await this.syncCase(id);}catch(error){this.pending.add(id);throw error;}}
  })().finally(()=>{this.running=undefined;});
 }
 private async loop():Promise<void>{try{await this.runOnce();}catch{this.logger.error('Search synchronization failed; retry scheduled');}finally{if(!this.stopped){this.timer=setTimeout(()=>void this.loop(),30_000);this.timer.unref();}}}
 async syncCase(id:string):Promise<void>{
  // Reload current PG state for every retry; queued snapshots cannot republish an old version.
  const [item]=await this.db.query(`SELECT c.id AS case_id,${revisionKey} AS revision_key,c.system_code,c.source,
   COALESCE(c.clinical_text,'') AS clinical_text,COALESCE(r.raw_text,'') AS report_text
   FROM cases c ${reportJoin} WHERE c.id=$1 AND ${publishedPredicate}`,[id]) as SearchDocument[];
  if(item)await this.elastic.put(item);else await this.elastic.remove(id);
 }
 private async reconcile():Promise<void>{
  let after:string|null=null;
  while(true){
   const rows=await this.db.query('SELECT id FROM cases WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 100',[after]) as {id:string}[];
   const documents=rows.length?await this.db.query(`SELECT c.id AS case_id,${revisionKey} AS revision_key,c.system_code,c.source,
    COALESCE(c.clinical_text,'') AS clinical_text,COALESCE(r.raw_text,'') AS report_text FROM cases c ${reportJoin}
    WHERE c.id=ANY($1::uuid[]) AND ${publishedPredicate}`,[rows.map(row=>row.id)]) as SearchDocument[]:[];
   const active=new Set(documents.map(item=>item.case_id));
   await this.elastic.bulk(documents,rows.filter(row=>!active.has(row.id)).map(row=>row.id));
   if(rows.length<100)break;after=rows[rows.length-1]!.id;
  }
  for(const id of await this.elastic.ids()){
   // Recheck just before deletion, including concurrent new cases; do not use an old ID snapshot.
   const [row]=await this.db.query('SELECT id FROM cases WHERE id::text=$1',[id]);
   if(!row)await this.elastic.remove(id);
  }
 }
}
