import { BadRequestException } from '@nestjs/common';
import { integer, uuid } from '../annotations/annotation-input';
export interface ReviewChecks {kind:'checks';deidentification:boolean;confirmation_basis:boolean;disease_label:boolean}
export type ReviewComment = ReviewChecks | {kind:'object';annotation_id:string;text:string} | {kind:'overall';text:string};
function fields(value:unknown,keys:string[]):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k))) throw new BadRequestException('审核字段无效');
  return value as Record<string,unknown>;
}
export function parseReview(body:unknown) {
  const input=fields(body,['expected_version','result','comments','assignment_id']);
  const expected_version=integer(input.expected_version);
  if(input.result!=='通过'&&input.result!=='打回')throw new BadRequestException('审核结果无效');
  if(!Array.isArray(input.comments))throw new BadRequestException('审核批注必须为数组');
  const comments:ReviewComment[]=input.comments.map(value=>{
    const item=fields(value,['kind','deidentification','confirmation_basis','disease_label','annotation_id','text']);
    if(item.kind==='checks'){
      fields(value,['kind','deidentification','confirmation_basis','disease_label']);
      if([item.deidentification,item.confirmation_basis,item.disease_label].some(v=>typeof v!=='boolean'))throw new BadRequestException('请完成三项一票否决检查');
      return {kind:'checks',deidentification:item.deidentification,confirmation_basis:item.confirmation_basis,disease_label:item.disease_label} as ReviewChecks;
    }
    if(item.kind!=='object'&&item.kind!=='overall')throw new BadRequestException('审核批注类型无效');
    fields(value,item.kind==='object'?['kind','annotation_id','text']:['kind','text']);
    if(typeof item.text!=='string'||!item.text.trim())throw new BadRequestException('请输入可执行的审核意见');
    return item.kind==='object'?{kind:'object',annotation_id:uuid(item.annotation_id),text:item.text.trim()}:{kind:'overall',text:item.text.trim()};
  });
  const checks=comments.filter((c):c is ReviewChecks=>c.kind==='checks');
  if(checks.length!==1)throw new BadRequestException('必须且只能有一组三项检查');
  if(input.result==='通过'&&(!checks[0]!.deidentification||!checks[0]!.confirmation_basis||!checks[0]!.disease_label))throw new BadRequestException('一票否决项未通过，必须打回');
  if(input.result==='打回'&&comments.length===1)throw new BadRequestException('打回必须提供修改意见');
  return {expected_version,result:input.result,comments,...(input.assignment_id===undefined?{}:{assignment_id:uuid(input.assignment_id)})};
}
