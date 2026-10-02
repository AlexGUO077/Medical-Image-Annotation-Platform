import { describe,expect,it } from 'vitest';
import { reportExempt,submissionIssues } from './submission-check';
import type { AnnotationInput } from './annotation-input';
describe('conservative submission checks',()=>{
 it.each(['未见异常','无积液，未见结节','不除外炎症；需与感染鉴别。'])('exempts every prefixed clause: %s',text=>expect(reportExempt(text)).toBe(true));
 it.each(['','，；','未见积液，右肺结节','右肺结节，未见积液','考虑炎症','肺内未见结节'])('does not exempt unknown or mixed sentences: %s',text=>expect(reportExempt(text)).toBe(false));
 it('requires explicit object linkage and complete attributes, and independently covers report sentences',()=>{
  const a={id:'a',part_id:null,sign_tag_ids:[],confidence:null,report_sent_ids:[]} as unknown as AnnotationInput;
  expect(submissionIssues([a],[{idx:2,text:'肺结节'},{idx:9,text:'无积液'}])).toEqual({objects:[{id:'a',fields:['part_id','sign_tag_ids','confidence','report_sent_ids']}],sentence_ids:[2]});
  const complete={...a,part_id:'part',sign_tag_ids:['sign'],confidence:'典型' as const,report_sent_ids:[-1]};
  expect(submissionIssues([complete],[{idx:2,text:'肺结节'}]).sentence_ids).toEqual([2]);
  expect(submissionIssues([{...complete,report_sent_ids:[2]}],[{idx:2,text:'肺结节'}])).toEqual({objects:[],sentence_ids:[]});
  expect(submissionIssues([],[{idx:9,text:'无积液'}])).toEqual({objects:[],sentence_ids:[]});
 });
});
