import type { DataNode } from 'antd/es/tree';
import { Alert,Button,Card,Empty,Input,Pagination,Select,Space,Spin,Tree,Typography } from 'antd';
import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '../auth/types';
import { taxonomyApi } from '../taxonomy/api';
import type { TaxonomyNode,TaxonomyTreeResponse } from '../taxonomy/types';
import { libraryApi } from '../library/api';
import type { LibraryItem,SearchFilters,SearchResult } from '../library/types';
import { viewerApi,ViewerRequestError } from '../viewer/api';
const systems:Record<string,string>={cns:'中枢神经系统',headneck:'头颈',resp:'呼吸',circ:'循环',digest:'消化',uro:'泌尿',repro:'生殖',bone:'骨骼'};
function Thumbnail({item,token,onDenied}:{item:LibraryItem;token:string;onDenied(e:unknown):void}){
 const [url,setUrl]=useState<string>(),[error,setError]=useState(false);
 useEffect(()=>{const controller=new AbortController();let objectUrl:string|undefined;
  const s=item.thumbnail;if(s)viewerApi.frame(token,item.id,s,s.frame_index,s.default_window,controller.signal,item.version).then(({blob})=>{if(!controller.signal.aborted){objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}}).catch(e=>{if(!controller.signal.aborted){if(e instanceof ViewerRequestError&&[401,403,409,429,502].includes(e.status))onDenied(e);else setError(true);}});
  return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);viewerApi.clearPreloads(token,item.id);};
 },[item,token]);
 return url?<img src={url} alt={`${item.case_no} 安全缩略图`} style={{width:'100%',height:180,objectFit:'contain',background:'#111'}} draggable={false} onContextMenu={e=>e.preventDefault()}/>:<div style={{height:180,display:'grid',placeItems:'center'}}>{error?'缩略图暂不可用':item.thumbnail?<Spin/>:'暂无影像'}</div>;
}
export function LibraryPage({session,onExpired}:{session:Session;onExpired?():void}){
 const [dictionary,setDictionary]=useState<TaxonomyTreeResponse>(),[dictionaryError,setDictionaryError]=useState<string>();
 const [filters,setFilters]=useState<SearchFilters>({page:1,pageSize:20}),[q,setQ]=useState(''),[result,setResult]=useState<SearchResult>(),[error,setError]=useState<string>(),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;taxonomyApi.tree(session.token).then(data=>{if(live)setDictionary(data);}).catch(e=>{if(live)setDictionaryError(e instanceof Error?e.message:'分类树读取失败');});return()=>{live=false;};},[session.token]);
 useEffect(()=>{const controller=new AbortController();setResult(undefined);setError(undefined);libraryApi.search(session.token,filters,controller.signal).then(data=>{if(!controller.signal.aborted)setResult(data);}).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'检索失败');if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();}});return()=>controller.abort();},[session.token,filters,retry]);
 const allowed=Object.keys(systems).filter(s=>session.quals[s]?.some(q=>q==='annotate'||q==='review'));
 const roots=dictionary?.tree.filter(r=>allowed.some(s=>systems[s]===r.name))??[];
 const treeNode=(n:TaxonomyNode):DataNode=>({key:n.id,title:n.name,children:n.children.map(treeNode)});
 const change=(patch:SearchFilters)=>setFilters(old=>({...old,...patch,page:1}));
 const selectNode=(id:string)=>{const visit=(n:TaxonomyNode,system:string,part?:string):boolean=>{if(n.id===id){change({system_code:system,part_id:n.level===2?n.id:part,disease_id:n.level>=3?n.id:undefined,sign_tag_id:undefined});return true;}return n.children.some(c=>visit(c,system,n.level===2?n.id:part));};for(const r of roots)if(visit(r,Object.keys(systems).find(s=>systems[s]===r.name)!))break;};
 const denied=(e:unknown)=>{setResult(undefined);setError(e instanceof Error?e.message:'病例已不可访问，请重新检索');if(e instanceof ViewerRequestError&&e.status===401)onExpired?.();};
 return <section aria-label="已发布病例库"><Typography.Title level={2}>病例库</Typography.Title><p>已发布金标准 · 按系统资格只读访问</p>
 {dictionaryError&&<Alert type="warning" message={dictionaryError}/>}
 <div style={{display:'grid',gridTemplateColumns:'220px minmax(0,1fr)',gap:24}}><aside><Typography.Title level={4}>系统 / 部位 / 疾病 / 亚型</Typography.Title><Tree treeData={roots.map(treeNode)} onSelect={keys=>{if(keys[0])selectNode(String(keys[0]));}}/></aside><main>
 <Space wrap><Select aria-label="检索系统" allowClear placeholder="系统" style={{width:130}} value={filters.system_code} options={allowed.map(s=>({value:s,label:systems[s]}))} onChange={v=>change({system_code:v,part_id:undefined,disease_id:undefined,sign_tag_id:undefined})}/>
 <Select aria-label="检索征象" allowClear placeholder="征象" style={{width:180}} value={filters.sign_tag_id} options={(dictionary?.sign_tags??[]).filter(s=>allowed.includes(s.system_code)&&(!filters.system_code||filters.system_code===s.system_code)).map(s=>({value:s.id,label:s.name}))} onChange={v=>change({sign_tag_id:v})}/>
 <Select aria-label="检索模态" allowClear placeholder="模态" style={{width:110}} value={filters.modality} options={['CR','DX','CT','MR','US'].map(v=>({value:v,label:v}))} onChange={v=>change({modality:v})}/>
 <Select aria-label="检索来源" allowClear placeholder="来源" style={{width:130}} value={filters.source} options={[{value:'synthetic',label:'合成数据'}]} onChange={v=>change({source:v})}/>
 <Input.Search aria-label="报告与临床全文" value={q} maxLength={200} placeholder="报告 / 临床全文" style={{width:250}} onChange={e=>setQ(e.target.value)} onSearch={()=>change({q:q.trim()||undefined})}/>
 <Button onClick={()=>{setQ('');setFilters({page:1,pageSize:20});}}>清除筛选</Button></Space>
 {(filters.part_id||filters.disease_id)&&<p>分类筛选已应用；不同条件同时满足。</p>}
 {error?<Alert type="error" message={error} action={<Button onClick={()=>setRetry(n=>n+1)}>重新检索</Button>}/>:!result?<Spin/>:result.items.length===0?<Empty description="暂无符合条件的已发布病例"/>:<>
 <p>共 {result.total} 例</p><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:16}}>{result.items.map(item=><Card key={`${item.id}:${item.version}`} title={<Link to={`/library/${item.id}`}>{item.case_no}</Link>} cover={<Thumbnail item={item} token={session.token} onDenied={denied}/>}><p>{systems[item.system_code]} · {item.modalities.join(' / ')} · 合成数据</p><p>疾病：{item.disease?.name??'暂无'}</p><p>征象：{item.signs.map(s=>s.name).join('、')||'暂无'}</p><p>金标准版本 {item.version}</p></Card>)}</div>
 <Pagination style={{marginTop:20}} current={result.page} pageSize={result.pageSize} total={result.total} showSizeChanger={false} onChange={page=>setFilters(old=>({...old,page}))}/></>}
 </main></div></section>;
}
