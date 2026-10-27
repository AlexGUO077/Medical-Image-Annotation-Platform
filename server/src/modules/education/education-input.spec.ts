import { describe,it,expect } from 'vitest';
import { emptyAnswer,parseAnswer,submissionCheck,studentNumber } from './education-input';
const id='00000000-0000-4000-8000-000000000001';
const item={id,series_id:id,tool:'box',geometry:{x:1,y:2,w:10,h:20},frame_start:0,frame_end:0,key_frame_index:0,window_preset:null,part_id:null,confidence:null,sign_tag_ids:[],report_sent_ids:[],organ:'肺',description:'合成病变'};
describe('education answer contract',()=>{
 it('allows incomplete drafts but requires explicit complete submission',()=>{const {answer}=parseAnswer({expected_version:0,answer:emptyAnswer()});expect(()=>submissionCheck(answer)).toThrow();expect(()=>submissionCheck({...answer,body_part_id:id,normal:true,findings:'未见异常',impression:'合成正常'})).not.toThrow();});
 it('keeps object descriptions with validated geometry and rejects reference links',()=>{const a={...emptyAnswer(),body_part_id:id,findings:'合成所见',impression:'合成意见',objects:[item]};const parsed=parseAnswer({expected_version:0,answer:a});expect(parsed.answer.objects[0]).toMatchObject({organ:'肺',description:'合成病变'});expect(()=>submissionCheck(parsed.answer)).not.toThrow();expect(()=>parseAnswer({expected_version:0,answer:{...a,objects:[{...item,report_sent_ids:[0]}]}})).toThrow();});
 it.each([{normal:true,objects:[item]},{normal:false,objects:[]}])('does not accept contradictory normal/lesion submissions',change=>{expect(()=>submissionCheck({...emptyAnswer(),body_part_id:id,findings:'文字',impression:'文字',...change} as never)).toThrow();});
 it('rejects server field injection, duplicate objects, oversize texts and unknown geometry',()=>{for(const change of [{reference:{}},{findings:'x'.repeat(10001)},{objects:[item,item]},{objects:[{...item,geometry:{x:1,y:2,w:-1,h:10}}]}])expect(()=>parseAnswer({expected_version:0,answer:{...emptyAnswer(),...change}})).toThrow();});
 it('restricts account identifiers and explicit version numbers',()=>{expect(()=>studentNumber('../admin')).toThrow();expect(studentNumber('student_demo')).toBe('student_demo');expect(()=>parseAnswer({expected_version:-1,answer:emptyAnswer()})).toThrow();});
});
