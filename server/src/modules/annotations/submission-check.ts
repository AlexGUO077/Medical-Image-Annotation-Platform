import type { AnnotationInput } from './annotation-input';
export interface SubmissionSentence { idx:number; text:string }
/** D-40: only every nonempty clause with an approved prefix can exempt a sentence. */
export function reportExempt(text:string):boolean {
  const clauses=text.split(/[，,。；;！？!?\r\n]/u).map(value=>value.trim()).filter(Boolean);
  return clauses.length>0&&clauses.every(value=>/^(?:未见|无|不除外|需与)/u.test(value));
}
export function submissionIssues(annotations:AnnotationInput[],sentences:SubmissionSentence[]) {
  const linked=new Set(annotations.flatMap(a=>a.report_sent_ids.filter(id=>id>=0)));
  return {
    objects:annotations.flatMap(a=>{
      const fields:string[]=[];
      if(!a.part_id)fields.push('part_id');
      if(!a.sign_tag_ids.length)fields.push('sign_tag_ids');
      if(!a.confidence)fields.push('confidence');
      if(!a.report_sent_ids.length)fields.push('report_sent_ids');
      return fields.length?[{id:a.id,fields}]:[];
    }),
    sentence_ids:sentences.filter(s=>!linked.has(s.idx)&&!reportExempt(s.text)).map(s=>s.idx),
  };
}
