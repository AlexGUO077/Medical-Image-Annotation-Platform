import { BadRequestException } from '@nestjs/common';
export interface SubmissionIssues {objects:{id:string;fields:string[]}[];sentence_ids:number[]}
export class SubmissionValidationException extends BadRequestException {
 constructor(readonly issues:SubmissionIssues){super('标注或报告关联不完整');}
}
