import { Alert,Button,Checkbox,InputNumber,Modal,Radio,Select,Space,Tooltip,Typography } from 'antd';
import { useState } from 'react';
import { AnnotationSections } from './AnnotationSections';
import { ViewerIcon } from '../viewer/ViewerIcon';
import { objectColor } from '../viewer/workspaceConfig';
import type { Annotation } from './types';
import type { TaxonomyTreeResponse } from '../taxonomy/types';
import type { Series } from '../viewer/api';
import { frameMask,updateMask } from './drawing';
const roots:Record<string,string>={cns:'中枢神经系统',headneck:'头颈',resp:'呼吸',circ:'循环',digest:'消化',uro:'泌尿',repro:'生殖',bone:'骨骼'};
export const toolNames={point:'点',box:'矩形',polygon:'多边形',brush:'画笔'};
interface Props {colorIds?:string[];annotations:Annotation[];selected?:string;dictionary?:TaxonomyTreeResponse;system:string;series:Series[];frame:number;disabled:boolean;hidden:Set<string>;locked:Set<string>;onSelect(id:string):void;onChange(items:Annotation[]):void;onHidden(id:string):void;onLocked(id:string):void;onFrame(frame:number):void;}
export function AnnotationPanel(p:Props){
 const [batch,setBatch]=useState<string[]>([]),a=p.annotations.find(a=>a.id===p.selected);
 const index=(id:string)=>(p.colorIds??p.annotations.map(a=>a.id)).indexOf(id);
 const parts=p.dictionary?.tree.find(root=>root.name===roots[p.system])?.children??[],signs=p.dictionary?.sign_tags.filter(s=>s.system_code===p.system)??[];
 const locked=!!a&&p.locked.has(a.id),disabled=p.disabled||locked;
 const maskFrames=a?.tool==='brush'?((a.geometry as {frames?:{frame_index:number}[]}).frames??[]).map(f=>f.frame_index):[];
 const change=(values:Partial<Annotation>)=>{if(a&&!disabled)p.onChange(p.annotations.map(old=>old.id===a.id?{...old,...values}:old));};
 const copy=(offset:number)=>{
  if(!a||disabled)return;const next=p.frame+offset,series=p.series.find(s=>s.id===a.series_id);if(!series||next<0||next>=series.frame_count)return;
  if(a.tool==='brush'){
   const mask=frameMask(a,p.frame);if(!mask)return;
   const run=()=>{change({geometry:updateMask(a,next,mask),frame_start:Math.min(a.frame_start,next),frame_end:Math.max(a.frame_end,next)});p.onFrame(next);};
   if(frameMask(a,next))Modal.confirm({title:'目标帧已有掩膜，是否替换？',onOk:run});else run();
  }else{
   const copied={...a,id:crypto.randomUUID(),geometry:structuredClone(a.geometry),frame_start:next,frame_end:next,key_frame_index:next};p.onChange([...p.annotations,copied]);p.onSelect(copied.id);p.onFrame(next);
  }
 };
 return <div className="annotation-panel">
 <div className="object-list-toolbar"><span>{p.annotations.length} 个对象</span><Button size="small" disabled={p.disabled||!batch.some(id=>!p.locked.has(id))} onClick={()=>Modal.confirm({title:'删除所选未锁定对象？',onOk:()=>{p.onChange(p.annotations.filter(a=>!batch.includes(a.id)||p.locked.has(a.id)));setBatch([]);}})}>批量删除</Button></div>
 <AnnotationSections list={<>{!p.annotations.length&&<p className="panel-empty">选择工具并在影像上绘制对象。</p>}
 <ul className="annotation-object-list">{p.annotations.map(item=><li key={item.id} className={`annotation-object${item.id===p.selected?' is-selected':''}`} style={{borderLeftColor:objectColor(index(item.id))}}>
 <div className="object-row"><Checkbox disabled={p.disabled} aria-label={`选择对象 ${index(item.id)+1}`} checked={batch.includes(item.id)} onChange={e=>setBatch(old=>e.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/>
 <button className="object-select" type="button" onClick={()=>p.onSelect(item.id)}><ViewerIcon name={item.tool}/><b>对象 {index(item.id)+1} · {toolNames[item.tool]}</b></button>
 <Tooltip title={p.hidden.has(item.id)?'显示对象':'隐藏对象'}><Button type="text" size="small" aria-label={`${p.hidden.has(item.id)?'显示':'隐藏'}对象 ${index(item.id)+1}`} icon={<ViewerIcon name={p.hidden.has(item.id)?'hidden':'eye'}/>} onClick={()=>p.onHidden(item.id)}/></Tooltip>
 <Tooltip title={p.locked.has(item.id)?'对象已锁定':'锁定对象'}><Button type="text" size="small" disabled={p.disabled} aria-label={`${p.locked.has(item.id)?'解锁':'锁定'}对象 ${index(item.id)+1}`} icon={<ViewerIcon name={p.locked.has(item.id)?'lock':'unlock'}/>} onClick={()=>p.onLocked(item.id)}/></Tooltip></div>
 <button className="object-summary" type="button" onClick={()=>p.onSelect(item.id)}>{parts.find(n=>n.id===item.part_id)?.name??'部位待填写'} · 第 {item.frame_start+1}–{item.frame_end+1} 帧<span>{signs.filter(s=>item.sign_tag_ids.includes(s.id)).map(s=>s.name).join('、')||'征象待填写'}</span></button>
 {(!item.part_id||!item.confidence||!item.sign_tag_ids.length||!item.report_sent_ids.length)&&<span className="object-incomplete">属性或报告关联未完整</span>}{p.locked.has(item.id)&&<span className="object-state">已锁定</span>}{p.hidden.has(item.id)&&<span className="object-state">已隐藏</span>}
 </li>)}</ul></>} properties={<>
 {a&&<div className="annotation-properties">
 <div className="properties-heading"><span style={{color:objectColor(index(a.id))}}>对象 {index(a.id)+1}</span><b>属性</b></div>
 <span>序列 {p.series.findIndex(s=>s.id===a.series_id)+1}</span>
 {locked&&<Alert message="对象已锁定" type="info"/>}
 <label>部位<Select aria-label="标注部位" allowClear style={{width:'100%'}} disabled={disabled} value={a.part_id??undefined} options={parts.map(n=>({value:n.id,label:n.name}))} onChange={id=>change({part_id:id??null})}/></label>
 <label>征象<Select aria-label="标注征象" mode="multiple" showSearch filterOption={(input,option)=>{const sign=signs.find(s=>s.id===option?.value);return (sign?.name??'').toLowerCase().includes(input.toLowerCase());}} style={{width:'100%'}} disabled={disabled} value={a.sign_tag_ids} options={signs.map(s=>({value:s.id,label:s.name}))} onChange={ids=>change({sign_tag_ids:ids})}/></label>
 {signs.filter(s=>a.sign_tag_ids.includes(s.id)).map(s=><Typography.Paragraph key={s.id} type="secondary">{s.name}：{s.definition}</Typography.Paragraph>)}
 <label>置信度<Select aria-label="标注置信度" allowClear style={{width:'100%'}} disabled={disabled} value={a.confidence??undefined} options={[{value:'typical',label:'典型'},{value:'atypical',label:'不典型'}]} onChange={value=>change({confidence:value??null})}/></label>
 {p.series.find(s=>s.id===a.series_id)?.frame_count!==1&&<Space wrap>
 <label>起始帧<InputNumber aria-label="标注起始帧" disabled={disabled} min={1} max={Math.min(a.key_frame_index,...maskFrames)+1} value={a.frame_start+1} onChange={v=>{if(v!==null&&Number.isInteger(v))change({frame_start:v-1});}}/></label>
 <label>结束帧<InputNumber aria-label="标注结束帧" disabled={disabled} min={Math.max(a.key_frame_index,...maskFrames)+1} max={p.series.find(s=>s.id===a.series_id)?.frame_count} value={a.frame_end+1} onChange={v=>{if(v!==null&&Number.isInteger(v))change({frame_end:v-1});}}/></label>
 <label>代表帧<InputNumber aria-label="标注代表帧" disabled={disabled} min={a.frame_start+1} max={a.frame_end+1} value={a.key_frame_index+1} onChange={v=>{if(v!==null&&Number.isInteger(v)){const next=v-1;if(a.tool!=='brush'||next===a.key_frame_index)change({key_frame_index:next});else{const mask=frameMask(a,next)??frameMask(a,a.key_frame_index)!;const old=frameMask(a,a.key_frame_index)!;const frames=((a.geometry as {frames?:({frame_index:number}&typeof old)[]}).frames??[]).filter(f=>f.frame_index!==next);change({key_frame_index:next,geometry:{...mask,frames:[...frames,{width:old.width,height:old.height,rle:old.rle,frame_index:a.key_frame_index}]}});}}}}/></label>
 </Space>}
 <Space><Button disabled={disabled||p.frame===0} onClick={()=>copy(-1)}>复制到前一帧</Button><Button disabled={disabled||p.frame+1>=(p.series.find(s=>s.id===a.series_id)?.frame_count??0)} onClick={()=>copy(1)}>复制到后一帧</Button></Space>
 <Radio.Group aria-label="报告关联模式" disabled={disabled} value={a.report_sent_ids.includes(-1)?'unmentioned':'linked'} onChange={e=>change({report_sent_ids:e.target.value==='unmentioned'?[-1]:[]})}><Radio value="linked">关联报告句</Radio><Radio value="unmentioned">报告未提及</Radio></Radio.Group>
 <span>关联句：{a.report_sent_ids.includes(-1)?'报告未提及':a.report_sent_ids.length?a.report_sent_ids.join('、'):'尚未关联'}</span>
 </div>}
 {!a&&!!p.annotations.length&&<p className="panel-empty">选择对象查看与编辑属性</p>}
 </>}/>
 </div>;
}
