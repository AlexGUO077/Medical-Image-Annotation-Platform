import { describe,expect,it } from 'vitest';
import { parseReview } from './review-input';
const checks={kind:'checks',deidentification:true,confirmation_basis:true,disease_label:true};
const body={expected_version:3,result:'通过',comments:[checks]};
describe('review contract',()=>{
  it('requires all veto checks, prevents forged metadata and refuses unreasoned returns',()=>{
    expect(parseReview(body).result).toBe('通过');
    for(const change of [{comments:[]},{comments:[checks,checks]},{result:'待定'},{expected_version:-1},{reviewer_id:'forged'},
      {comments:[{...checks,disease_label:false}]},{comments:[{...checks,deidentification:undefined}]},{result:'打回'},
      {comments:[checks,{kind:'overall',text:'  '}]},{comments:[{...checks,annotation_version:3}]},
      {comments:[checks,{kind:'object',annotation_id:'bad',text:'修正轮廓'}]}])expect(()=>parseReview({...body,...change})).toThrow();
  });
  it('normalizes stable object IDs and text without inventing a third result',()=>{
    const parsed=parseReview({...body,result:'打回',comments:[{...checks,disease_label:false},{kind:'object',annotation_id:'ABCD0000-0000-4000-8000-000000000001',text:'  请核对报告关联。  '}]});
    expect(parsed.comments[1]).toEqual({kind:'object',annotation_id:'abcd0000-0000-4000-8000-000000000001',text:'请核对报告关联。'});
  });
});
