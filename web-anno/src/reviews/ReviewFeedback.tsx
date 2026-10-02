import { Alert,Button } from 'antd';
import type { Annotation } from '../annotations/types';
import type { ReviewRecord } from './types';
export function ReviewFeedback({review,annotations,onSelect}:{review:ReviewRecord|null|undefined;annotations:Annotation[];onSelect(id:string):void}){
  if(!review)return null;
  return <Alert type={review.result==='打回'?'warning':'info'} message={`最近审核：${review.result}`} description={<>
    <span>{new Date(review.created_at).toLocaleString()}</span>
    <ul>{review.comments.filter(c=>c.kind!=='checks').map((comment,index)=>{const exists=comment.kind==='object'&&annotations.some(a=>a.id===comment.annotation_id);
      return <li key={index}>{comment.text} {comment.kind==='object'&&(exists?<Button size="small" onClick={()=>onSelect(comment.annotation_id)}>定位对象与报告</Button>:<span>（历史对象，当前版本已不存在）</span>)}</li>;
    })}</ul>
  </>}/>;
}
