import { BadRequestException } from '@nestjs/common';
import { object, integer, parseAnnotations, uuid } from '../annotations/annotation-input';
export const emptyAnswer = () => ({ body_part_id:null as string|null, findings:'', impression:'', objects:[] as StudentObject[] });
export type StudentObject = ReturnType<typeof parseAnnotations>['annotations'][number] & {organ:string;description:string};
export interface StudentAnswer {body_part_id:string|null;normal?:boolean;findings:string;impression:string;objects:StudentObject[]}
export function text(value:unknown,max:number,required=false):string {
  if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new BadRequestException('文字为空或超过允许长度');
  return value.trim();
}
export function ids(value:unknown,max:number):string[]{
  if(!Array.isArray(value)||!value.length||value.length>max)throw new BadRequestException('请选择有效数量的项目');
  const result=value.map(uuid);if(new Set(result).size!==result.length)throw new BadRequestException('项目不能重复');return result;
}
export function studentNumber(value:unknown):string {
  const result=text(value,64,true);if(!/^[A-Za-z0-9_-]{3,64}$/.test(result))throw new BadRequestException('学号需为3至64位字母、数字、下划线或短横线');return result;
}
export function parseAnswer(body:unknown){
  const input=object(body,['expected_version','answer']);const version=integer(input.expected_version);
  if(Buffer.byteLength(JSON.stringify(input.answer)??'')>2*1024*1024)throw new BadRequestException('作答内容不能超过2MB');
  const a=object(input.answer,['body_part_id','normal','findings','impression','objects']);
  if((a.normal!==undefined&&typeof a.normal!=='boolean')||!Array.isArray(a.objects)||a.objects.length>200)throw new BadRequestException('作答格式或对象数量无效');
  const extras=a.objects.map(value=>{const o=object(value,['id','series_id','tool','geometry','frame_start','frame_end','key_frame_index','window_preset','part_id','sign_tag_ids','confidence','report_sent_ids','organ','description']);
    const {organ,description,...annotation}=o;
    if(!Array.isArray(annotation.report_sent_ids)||annotation.report_sent_ids.length)throw new BadRequestException('学生对象不接受参考报告关联');
    return {annotation,organ:text(organ,100),description:text(description,2000)};
  });
  const parsed=parseAnnotations({expected_version:version,annotations:extras.map(e=>e.annotation)});
  const answer:StudentAnswer={body_part_id:a.body_part_id===null?null:uuid(a.body_part_id),
    findings:text(a.findings,10000),impression:text(a.impression,5000),
    objects:parsed.annotations.map((o,i)=>({...o,organ:extras[i]!.organ,description:extras[i]!.description}))};
  return {version,answer};
}
export function submissionCheck(a:StudentAnswer){
  if(!a.body_part_id||!a.findings||!a.impression)throw new BadRequestException('请填写身体部位、影像所见和诊断意见');
  if(!a.objects.length)throw new BadRequestException('请至少标注一个病灶并填写该病灶的描述');
  const incomplete=a.objects.findIndex(o=>!o.organ||!o.description);
  if(incomplete>=0)throw new BadRequestException(`请填写病灶 ${incomplete+1} 的器官 / 位置和病变描述`);
}
export function publicAnswer(a:StudentAnswer){return {...a,objects:a.objects.map(o=>({...o,confidence:o.confidence===null?null:o.confidence==='典型'?'typical':'atypical'}))};}
