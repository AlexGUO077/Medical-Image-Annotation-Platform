import { Alert,Button,Modal,Space,Table,Typography } from 'antd';
import { useState } from 'react';
import type { Annotation } from './types';
import type { AnnotationSaveSession,SaveState } from './save-session';
export function SaveIndicator({state,engine,onAdopt,disabled=false}:{state:SaveState;disabled?:boolean;engine?:AnnotationSaveSession;onAdopt?:()=>void}){
 const [show,setShow]=useState(false);
 const labels={loading:'读取标注',saved:`已保存 · 版本 ${state.version}${state.savedAt?' · '+new Date(state.savedAt).toLocaleTimeString():''}`,dirty:'有未保存修改',saving:'正在保存',offline:'离线：未保存修改保留在本地草稿',conflict:'版本冲突：自动保存已暂停',blocked:'权限失效：标注已锁定',error:'保存失败：请重试'};
 const ids=[...new Set([...state.annotations,...(state.server?.annotations??[])].map(a=>a.id))];
 const summary=(a?:Annotation)=>!a?'已删除 / 不存在':`${({point:'点',box:'矩形',polygon:'多边形',brush:'画笔'})[a.tool]} · 第 ${a.frame_start+1}–${a.frame_end+1} 帧 · 征象 ${a.sign_tag_ids.length} 项 · ${a.report_sent_ids.includes(-1)?'报告未提及':a.report_sent_ids.length?'关联句 '+a.report_sent_ids.join('、'):'未关联报告'}`;
 const fields:Partial<Record<keyof Annotation,string>>={geometry:'形状或位置',series_id:'所属序列',part_id:'部位',sign_tag_ids:'征象',confidence:'置信度',frame_start:'起始帧',frame_end:'结束帧',key_frame_index:'代表帧',window_preset:'窗设置',report_sent_ids:'报告关联'};
 const rows=ids.map((id,i)=>({id,number:i+1,local:state.annotations.find(a=>a.id===id),server:state.server?.annotations.find(a=>a.id===id)}));
 return <><Space wrap><span role="status">{labels[state.status]}</span>
 <Button disabled={disabled||!state.dirty||state.checking||['offline','conflict','blocked','loading','error'].includes(state.status)} onClick={()=>void engine?.saveNow()}>保存标注</Button>
 {['error','conflict'].includes(state.status)&&<Button disabled={disabled||state.checking} onClick={()=>void engine?.recover()}>重新检查</Button>}
 {state.status==='conflict'&&<Button disabled={disabled} onClick={()=>{setShow(true);if(!state.server)void engine?.recover();}}>查看冲突</Button>}
 </Space>{state.error&&<Alert type="error" message={state.error}/>} {state.storageError&&<Alert type="error" message={state.storageError}/>}
 <Modal title="标注版本冲突" open={show} onCancel={()=>setShow(false)} footer={<Space><Button onClick={()=>setShow(false)}>保留本地草稿</Button><Button danger disabled={disabled||!state.server||state.checking} onClick={()=>Modal.confirm({title:'放弃本地修改并采用服务器版本？',onOk:async()=>{await engine?.useServer();if(engine?.snapshot().status==='saved'){onAdopt?.();setShow(false);}}})}>采用服务器版本</Button></Space>} width={900}>
 <Typography.Paragraph>本地基准版本 {state.version}，服务器版本 {state.server?.current_version??'待读取'}。不会自动覆盖服务器。</Typography.Paragraph>
 <Table pagination={false} rowKey="id" dataSource={rows} columns={[{title:'对象',dataIndex:'number'},{title:'本地',render:(_,row)=>summary(row.local)},{title:'服务器',render:(_,row)=>summary(row.server)},{title:'差异',render:(_,row)=>!row.local||!row.server?'对象新增或删除':(Object.keys(fields) as (keyof Annotation)[]).filter(key=>JSON.stringify(row.local![key])!==JSON.stringify(row.server![key])).map(key=>fields[key]).join('、')||'一致'}]}/>
 </Modal></>;
}
