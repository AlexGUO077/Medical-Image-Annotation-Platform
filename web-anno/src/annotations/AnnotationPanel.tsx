import { Alert,Button,Checkbox,InputNumber,Modal,Select,Space,Typography } from 'antd';
import { useState } from 'react';
import type { Annotation } from './types';
import type { TaxonomyTreeResponse } from '../taxonomy/types';
import type { Series } from '../viewer/api';
import { frameMask,updateMask } from './drawing';
const roots:Record<string,string>={cns:'中枢神经系统',headneck:'头颈',resp:'呼吸',circ:'循环',digest:'消化',uro:'泌尿',repro:'生殖',bone:'骨骼'};
export const toolNames={point:'点',box:'矩形',polygon:'多边形',brush:'画笔'};
interface Props {annotations:Annotation[];selected?:string;dictionary?:TaxonomyTreeResponse;system:string;series:Series[];frame:number;disabled:boolean;hidden:Set<string>;locked:Set<string>;onSelect(id:string):void;onChange(items:Annotation[]):void;onHidden(id:string):void;onLocked(id:string):void;onFrame(frame:number):void;}
export function AnnotationPanel(p:Props){
 const [batch,setBatch]=useState<string[]>([]),a=p.annotations.find(a=>a.id===p.selected);
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
 return <><Typography.Title level={4}>标注对象</Typography.Title>
 <Space wrap><Button disabled={p.disabled||!batch.some(id=>!p.locked.has(id))} onClick={()=>Modal.confirm({title:'删除所选未锁定对象？',onOk:()=>{p.onChange(p.annotations.filter(a=>!batch.includes(a.id)||p.locked.has(a.id)));setBatch([]);}})}>批量删除</Button></Space>
 {!p.annotations.length&&<p>选择工具并在影像上绘制对象。</p>}
 <ul style={{padding:0,listStyle:'none'}}>{p.annotations.map((item,i)=><li key={item.id} style={{borderBottom:'1px solid #ddd',padding:'8px 0'}}>
 <Checkbox aria-label={`选择对象 ${i+1}`} checked={batch.includes(item.id)} onChange={e=>setBatch(old=>e.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/>
 <Button type={item.id===p.selected?'primary':'text'} onClick={()=>p.onSelect(item.id)}>对象 {i+1} · {toolNames[item.tool]}</Button>
 <div>{parts.find(n=>n.id===item.part_id)?.name??'部位待填写'} · {item.frame_start+1}–{item.frame_end+1} 帧</div>
 {(!item.part_id||!item.confidence||!item.sign_tag_ids.length)&&<Typography.Text type="warning">属性未完整</Typography.Text>}
 <Space><Button size="small" onClick={()=>p.onHidden(item.id)}>{p.hidden.has(item.id)?'显示':'隐藏'}</Button><Button size="small" onClick={()=>p.onLocked(item.id)}>{p.locked.has(item.id)?'解锁':'锁定'}</Button></Space>
 </li>)}</ul>
 {a&&<Space direction="vertical" style={{width:'100%'}}>
 <b>对象 {p.annotations.indexOf(a)+1} · {toolNames[a.tool]}</b>
 <span>序列 {p.series.findIndex(s=>s.id===a.series_id)+1}</span>
 {locked&&<Alert message="对象已锁定" type="info"/>}
 <label>部位<Select aria-label="标注部位" allowClear style={{width:'100%'}} disabled={disabled} value={a.part_id??undefined} options={parts.map(n=>({value:n.id,label:n.name}))} onChange={id=>change({part_id:id??null})}/></label>
 <label>征象<Select aria-label="标注征象" mode="multiple" showSearch optionFilterProp="label" style={{width:'100%'}} disabled={disabled} value={a.sign_tag_ids} options={signs.map(s=>({value:s.id,label:s.name}))} onChange={ids=>change({sign_tag_ids:ids})}/></label>
 {signs.filter(s=>a.sign_tag_ids.includes(s.id)).map(s=><Typography.Paragraph key={s.id} type="secondary">{s.name}：{s.definition}</Typography.Paragraph>)}
 <label>置信度<Select aria-label="标注置信度" allowClear style={{width:'100%'}} disabled={disabled} value={a.confidence??undefined} options={[{value:'typical',label:'典型'},{value:'atypical',label:'不典型'}]} onChange={value=>change({confidence:value??null})}/></label>
 {p.series.find(s=>s.id===a.series_id)?.frame_count!==1&&<Space wrap>
 <label>起始帧<InputNumber aria-label="标注起始帧" disabled={disabled} min={1} max={Math.min(a.key_frame_index,...maskFrames)+1} value={a.frame_start+1} onChange={v=>{if(v!==null&&Number.isInteger(v))change({frame_start:v-1});}}/></label>
 <label>结束帧<InputNumber aria-label="标注结束帧" disabled={disabled} min={Math.max(a.key_frame_index,...maskFrames)+1} max={p.series.find(s=>s.id===a.series_id)?.frame_count} value={a.frame_end+1} onChange={v=>{if(v!==null&&Number.isInteger(v))change({frame_end:v-1});}}/></label>
 <label>代表帧<InputNumber aria-label="标注代表帧" disabled={disabled} min={a.frame_start+1} max={a.frame_end+1} value={a.key_frame_index+1} onChange={v=>{if(v!==null&&Number.isInteger(v)){const next=v-1;if(a.tool!=='brush'||next===a.key_frame_index)change({key_frame_index:next});else{const mask=frameMask(a,next)??frameMask(a,a.key_frame_index)!;const old=frameMask(a,a.key_frame_index)!;const frames=((a.geometry as {frames?:({frame_index:number}&typeof old)[]}).frames??[]).filter(f=>f.frame_index!==next);change({key_frame_index:next,geometry:{...mask,frames:[...frames,{width:old.width,height:old.height,rle:old.rle,frame_index:a.key_frame_index}]}});}}}}/></label>
 </Space>}
 <Space><Button disabled={disabled||p.frame===0} onClick={()=>copy(-1)}>复制到前一帧</Button><Button disabled={disabled||p.frame+1>=(p.series.find(s=>s.id===a.series_id)?.frame_count??0)} onClick={()=>copy(1)}>复制到后一帧</Button></Space>
 <Checkbox disabled={disabled} checked={a.report_sent_ids.includes(-1)} onChange={e=>change({report_sent_ids:e.target.checked?[-1]:[]})}>报告未提及</Checkbox>
 <span>关联句：{a.report_sent_ids.includes(-1)?'报告未提及':a.report_sent_ids.length?a.report_sent_ids.join('、'):'尚未关联'}</span>
 </Space>}
 </>;
}
