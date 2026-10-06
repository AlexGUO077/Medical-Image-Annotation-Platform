import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { requiredEnv } from '../../config/environment';

export const indexMapping={dynamic:'strict',properties:{
 case_id:{type:'keyword'},revision_key:{type:'keyword'},system_code:{type:'keyword'},source:{type:'keyword'},
 report_text:{type:'text',analyzer:'standard'},clinical_text:{type:'text',analyzer:'standard'},
}};
export interface SearchDocument {case_id:string;revision_key:string;system_code:string;source:string;report_text:string;clinical_text:string}
@Injectable()
export class ElasticService {
 get index():string {
  const value=process.env.SEARCH_ELASTIC_INDEX??'miap-published-v1';
  if(!/^miap-published-[a-z0-9-]+$/.test(value))throw new ServiceUnavailableException('检索索引配置无效');
  return value;
 }
 async request(method:string,path:string,body?:unknown,missing=false):Promise<any> {
  try {
   const host=requiredEnv('ELASTICSEARCH_HOST'),port=requiredEnv('ELASTICSEARCH_PORT');
   if(!/^[a-zA-Z0-9.-]+$/.test(host)||!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Invalid ES endpoint');
   const user=requiredEnv('SEARCH_ELASTIC_USERNAME'),password=requiredEnv('SEARCH_ELASTIC_PASSWORD');
   if(user==='elastic')throw Error('Dedicated search account required');
   const response=await fetch(`http://${host}:${port}/${this.index}${path}`,{
    method,redirect:'error',signal:AbortSignal.timeout(10_000),headers:{
     Authorization:`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
     'Content-Type':typeof body==='string'?'application/x-ndjson':'application/json',
    },...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),
   });
   if(response.status===404&&missing)return null;
   if(!response.ok)throw Error('ES request failed');
   return method==='HEAD'?true:await response.json();
  }catch{throw new ServiceUnavailableException('全文检索暂不可用，请稍后重试');}
 }
 async ensure():Promise<void> {
  if(await this.request('HEAD','',undefined,true))return;
  try{await this.request('PUT','',{settings:{number_of_shards:1,number_of_replicas:0},mappings:indexMapping});}
  catch(error){if(!await this.request('HEAD','',undefined,true))throw error;}
 }
 async put(document:SearchDocument):Promise<void> {await this.request('PUT',`/_doc/${document.case_id}?refresh=wait_for`,document);}
 async remove(id:string):Promise<void> {await this.request('DELETE',`/_doc/${encodeURIComponent(id)}?refresh=wait_for`,undefined,true);}
 async bulk(documents:SearchDocument[],removed:string[]):Promise<void> {
  const operations=[...documents.map(doc=>({id:doc.case_id,kind:'index',doc})),...removed.map(id=>({id,kind:'delete',doc:undefined}))];
  if(!operations.length)return;
  const body=operations.map(op=>JSON.stringify({[op.kind]:{_id:op.id}})+'\n'+(op.doc?JSON.stringify(op.doc)+'\n':'')).join('');
  const data=await this.request('POST','/_bulk?refresh=wait_for',body);
  if(data.errors!==false||!Array.isArray(data.items)||data.items.length!==operations.length)throw new ServiceUnavailableException('索引批量同步未完成');
  for(const [i,op]of operations.entries()){
   const item=data.items[i]?.[op.kind];
   if(item?._id!==op.id||!([200,201].includes(item?.status)||(op.kind==='delete'&&item?.status===404))||item?.error)throw new ServiceUnavailableException('索引批量同步未完成');
  }
 }
 async match(q:string,revisions:string[]):Promise<string[]> {
  if(!revisions.length){await this.request('HEAD','');return [];}
  const matches:{key:string;score:number}[]=[];
  // ES terms limit is 65536; batch this internal authorized scope rather than truncate results.
  for(let offset=0;offset<revisions.length;offset+=20_000){
   const keys=revisions.slice(offset,offset+20_000),allowed=new Set(keys);let after:unknown[]|undefined;
   while(true){
    const data=await this.request('POST','/_search',{
     size:500,_source:false,fields:['revision_key'],track_total_hits:false,
     sort:[{_score:'desc'},{case_id:'asc'}],...(after?{search_after:after}:{}),
     query:{bool:{filter:[{terms:{revision_key:keys}}],must:[{multi_match:{query:q,fields:['report_text','clinical_text'],type:'cross_fields',operator:'and'}}]}},
    });
    if(data.timed_out!==false||data._shards?.failed!==0)throw new ServiceUnavailableException('检索结果不完整');
    const hits=data.hits?.hits;
    if(!Array.isArray(hits))throw new ServiceUnavailableException('检索响应无效');
    for(const hit of hits){const key=hit.fields?.revision_key?.[0];if(typeof key!=='string'||!allowed.has(key)||!Number.isFinite(hit._score))throw new ServiceUnavailableException('检索响应无效');matches.push({key,score:hit._score});}
    if(hits.length<500)break;
    const next=hits[hits.length-1]?.sort;
    if(!Array.isArray(next)||next.length!==2||JSON.stringify(next)===JSON.stringify(after))throw new ServiceUnavailableException('检索分页响应无效');
    after=next;
   }
  }
  return [...new Set(matches.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key)).map(item=>item.key))];
 }
 async ids():Promise<string[]> {
  const ids:string[]=[];let after:string|undefined;
  while(true){
   const data=await this.request('POST','/_search',{size:500,_source:false,sort:[{case_id:'asc'}],...(after?{search_after:[after]}:{}),query:{match_all:{}}});
   if(data.timed_out!==false||data._shards?.failed!==0)throw new ServiceUnavailableException('检索结果不完整');
    const hits=data.hits?.hits;if(!Array.isArray(hits))throw new ServiceUnavailableException('索引对账响应无效');
   for(const hit of hits)if(typeof hit._id==='string')ids.push(hit._id);else throw new ServiceUnavailableException('索引对账响应无效');
   if(hits.length<500)break;
   const next=hits[hits.length-1]?.sort?.[0];if(typeof next!=='string'||next===after)throw new ServiceUnavailableException('索引对账分页无效');after=next;
  }
  return ids;
 }
}
