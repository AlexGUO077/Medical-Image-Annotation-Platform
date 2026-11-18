import { describe,it,expect } from 'vitest';
import { emptyAnswer,parseAnswer,submissionCheck,studentNumber } from './education-input';
import { parseAnnotations } from '../annotations/annotation-input';
const id='00000000-0000-4000-8000-000000000001';
const item={id,series_id:id,tool:'box',geometry:{x:1,y:2,w:10,h:20},frame_start:0,frame_end:0,key_frame_index:0,window_preset:null,part_id:null,confidence:null,sign_tag_ids:[],report_sent_ids:[],organ:'肺',description:'合成病变'};
describe('education answer contract',()=>{
 it('allows an empty draft and requires a lesion even on a legacy normal draft',()=>{
  const report={...emptyAnswer(),body_part_id:id,findings:'学生所见',impression:'学生判断'};
  for(const saved of [report,{...report,normal:true},{...report,normal:false}]){
   const {answer}=parseAnswer({expected_version:0,answer:saved});
   expect(answer.objects).toEqual([]);expect(()=>submissionCheck(answer)).toThrow('至少标注一个病灶');
   expect(()=>submissionCheck(saved)).toThrow('至少标注一个病灶');
  }
 });
 it('keeps object descriptions with validated geometry and rejects reference links',()=>{const a={...emptyAnswer(),body_part_id:id,findings:'合成所见',impression:'合成意见',objects:[item]};const parsed=parseAnswer({expected_version:0,answer:a});expect(parsed.answer.objects[0]).toMatchObject({organ:'肺',description:'合成病变'});expect(()=>submissionCheck(parsed.answer)).not.toThrow();expect(()=>parseAnswer({expected_version:0,answer:{...a,objects:[{...item,report_sent_ids:[0]}]}})).toThrow();});
 it('validates each lesion and returns the index of the incomplete record',()=>{
  const second={...item,id:'00000000-0000-4000-8000-000000000002',organ:'另一位置',description:'另一表现'};
  const {answer}=parseAnswer({expected_version:0,answer:{...emptyAnswer(),body_part_id:id,findings:'所见',impression:'判断',objects:[item,second]}});
  expect(answer.objects.map(o=>o.organ)).toEqual(['肺','另一位置']);expect(()=>submissionCheck(answer)).not.toThrow();
  answer.objects[1]!.description='';expect(()=>submissionCheck(answer)).toThrow('病灶 2');
 });
 it('rejects server field injection, duplicate objects, oversize texts and unknown geometry',()=>{for(const change of [{reference:{}},{findings:'x'.repeat(10001)},{objects:[item,item]},{objects:[{...item,geometry:{x:1,y:2,w:-1,h:10}}]}])expect(()=>parseAnswer({expected_version:0,answer:{...emptyAnswer(),...change}})).toThrow();});
 it('keeps student points in one lesion and validates each coordinate and frame',()=>{
  const point={...item,tool:'point',frame_end:2,geometry:{x:6,y:8,additional_points:[{frame_index:0,x:12,y:18},{frame_index:2,x:5,y:7}]}};
  const parse=(object:unknown)=>parseAnswer({expected_version:0,answer:{...emptyAnswer(),objects:[object]}}).answer.objects;
  expect(parse(point)).toMatchObject([{id:item.id,geometry:point.geometry}]);
  expect(parse({...point,geometry:{x:6,y:8}})[0]!.geometry).toEqual({x:6,y:8});
  for(const invalid of [{frame_index:3,x:10,y:10},{frame_index:1.5,x:5,y:5},{frame_index:1,x:-1,y:10}]){
   expect(()=>parse({...point,geometry:{x:6,y:8,additional_points:[invalid]}})).toThrow();
  }
  const {organ,description,...production}=point;
  expect(()=>parseAnnotations({expected_version:0,annotations:[production]})).toThrow();
 });
 it('restricts account identifiers and explicit version numbers',()=>{expect(()=>studentNumber('../admin')).toThrow();expect(studentNumber('student_demo')).toBe('student_demo');expect(()=>parseAnswer({expected_version:-1,answer:emptyAnswer()})).toThrow();});
});
