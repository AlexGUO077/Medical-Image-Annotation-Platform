import { afterEach,describe,expect,it,vi } from 'vitest';
import { Logger,ServiceUnavailableException } from '@nestjs/common';
import { ElasticService } from './elastic.service';
import { SearchSyncService } from './search-sync.service';
import { requestSearchSync } from './search-events';
import { parseSearch } from './search-input';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('search inputs',()=>{
 it('normalizes plain query and rejects ambiguous/unsafe inputs',()=>{
  expect(parseSearch({q:' 肺部结节 ',page:'2',pageSize:'5'})).toEqual({q:'肺部结节',page:2,pageSize:5});
  for(const query of [{q:['a','b']},{q:{}},{page:'01'},{page:'9007199254740991',pageSize:'100'},{pageSize:'101'},{source:'real'},{system_code:'__proto__'},{part_id:'bad'},{q:'a'.repeat(201)},{dsl:'x'}])expect(()=>parseSearch(query)).toThrow();
 });
});
describe('ES complete results only',()=>{
 const response=(hits:unknown[],extra={})=>({timed_out:false,_shards:{failed:0},hits:{hits},...extra});
 it('passes text as data, scans search_after and orders authorized revisions',async()=>{
  const service=new ElasticService(),keys=Array.from({length:501},(_,i)=>`case${i}:v1`);
  const request=vi.spyOn(service,'request').mockResolvedValueOnce(response(keys.slice(0,500).map((key,i)=>({fields:{revision_key:[key]},_score:2,sort:[2,String(i)]})))).mockResolvedValueOnce(response([{fields:{revision_key:[keys[500]]},_score:1,sort:[1,'500']}]));
  expect(await service.match('{"match_all":{}}',keys)).toEqual([...keys.slice(0,500).sort((a,b)=>a.localeCompare(b)),keys[500]]);
  expect(request.mock.calls[1]![2]).toMatchObject({search_after:[2,'499']});
  expect(request.mock.calls[0]![2]).toMatchObject({query:{bool:{must:[{multi_match:{query:'{"match_all":{}}',operator:'and',type:'cross_fields'}}]}}});
 });
 it.each([{timed_out:true},{_shards:{failed:1}},{hits:{hits:[{fields:{revision_key:['foreign']},_score:1}]}}])('fails partial/foreign responses %j',async change=>{
  const service=new ElasticService();vi.spyOn(service,'request').mockResolvedValue(response([],change));await expect(service.match('q',['authorized'])).rejects.toBeInstanceOf(ServiceUnavailableException);
 });
 it('fails even an empty authorized scope on an unavailable index',async()=>{
  const service=new ElasticService();vi.spyOn(service,'request').mockRejectedValue(new ServiceUnavailableException());await expect(service.match('q',[])).rejects.toThrow();
 });
 it('rejects partially failed bulk writes and accepts idempotent missing deletes',async()=>{
  const service=new ElasticService(),request=vi.spyOn(service,'request');
  const doc={case_id:'case',revision_key:'v1',system_code:'resp',source:'synthetic',report_text:'safe',clinical_text:''};
  request.mockResolvedValueOnce({errors:true,items:[{index:{_id:'case',status:201}},{delete:{_id:'old',status:500,error:{reason:'synthetic'}}}]});await expect(service.bulk([doc],['old'])).rejects.toThrow('索引批量同步未完成');
  request.mockResolvedValueOnce({errors:false,items:[{index:{_id:'case',status:201}},{delete:{_id:'old',status:404}}]});await expect(service.bulk([doc],['old'])).resolves.toBeUndefined();
 });
 it('redacts endpoint, credentials and upstream errors',async()=>{
  vi.stubEnv('ELASTICSEARCH_HOST','localhost');vi.stubEnv('ELASTICSEARCH_PORT','9200');vi.stubEnv('SEARCH_ELASTIC_USERNAME','miap_search');vi.stubEnv('SEARCH_ELASTIC_PASSWORD','synthetic-secret');
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('synthetic-secret at private endpoint')));
  await expect(new ElasticService().request('POST','/_search')).rejects.toThrow('全文检索暂不可用，请稍后重试');
 });
});
describe('PG truth synchronization',()=>{
 it('retries events using fresh PG state, reconciles after restart and daily, removes orphans',async()=>{
  vi.spyOn(Logger.prototype,'error').mockImplementation(()=>{});
  let published=true,version=1;
  const db={query:vi.fn(async(sql:string)=>sql.startsWith('SELECT c.id')?(published?[{case_id:'case',revision_key:`case:${version}`,source:'synthetic',system_code:'resp',report_text:'safe',clinical_text:''}]:[]):sql.startsWith('SELECT id FROM cases WHERE ($1')?[{id:'case'}]:[])};
  const elastic={ensure:vi.fn().mockResolvedValue(undefined),put:vi.fn().mockResolvedValue(undefined),remove:vi.fn().mockResolvedValue(undefined),ids:vi.fn().mockResolvedValue(['orphan'])};
  const batch={...elastic,bulk:vi.fn(async(documents:{case_id:string}[],removed:string[])=>{for(const document of documents)await elastic.put(document);for(const id of removed)await elastic.remove(id);})};
  const sync=new SearchSyncService(db as never,batch as never);
  try{
   await sync.runOnce();expect(elastic.put).toHaveBeenCalledWith(expect.objectContaining({revision_key:'case:1'}));expect(elastic.remove).toHaveBeenCalledWith('orphan');
   sync.onApplicationBootstrap();await sync.runOnce();elastic.ensure.mockRejectedValueOnce(new Error('ES unavailable'));requestSearchSync('case');await sync.runOnce().catch(()=>{});
   published=false;await sync.runOnce();expect(elastic.remove).toHaveBeenCalledWith('case');
   version=2;published=true;await sync.runOnce(true);expect(elastic.put).toHaveBeenLastCalledWith(expect.objectContaining({revision_key:'case:2'}));
   const calls=elastic.put.mock.calls.length;vi.spyOn(Date,'now').mockReturnValue(Date.now()+24*60*60*1000+1);await sync.runOnce();expect(elastic.put).toHaveBeenCalledTimes(calls+1);
  }finally{await sync.onModuleDestroy();}
  const restarted=new SearchSyncService(db as never,batch as never);try{await restarted.runOnce();expect(elastic.put).toHaveBeenLastCalledWith(expect.objectContaining({revision_key:'case:2'}));}finally{await restarted.onModuleDestroy();}
 });
});
