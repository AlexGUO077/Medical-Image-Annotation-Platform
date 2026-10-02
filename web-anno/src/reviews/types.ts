import type { AnnotationRead } from '../annotations/types';
import type { Workbench } from '../viewer/api';
export interface ReviewChecks {kind:'checks';deidentification:boolean;confirmation_basis:boolean;disease_label:boolean}
export type ReviewComment=ReviewChecks|{kind:'object';annotation_id:string;text:string}|{kind:'overall';text:string};
export type RecordedComment=ReviewComment&{reviewer_id:string;created_at:string;annotation_version:number};
export interface ReviewRecord {id:string;reviewer_id:string;result:'通过'|'打回';comments:RecordedComment[];created_at:string;is_spotcheck:boolean}
export interface ReviewData extends Workbench,AnnotationRead {disease:{id:string;name:string}|null;review_mode:'self'|'peer';latest_review:ReviewRecord|null}
export interface ReviewResult {review_id:string;case_id:string;version:number;status:'已发布'|'标注中'|'待分配';is_gold:boolean;reannotation:{assignment_id:string|null;assignee_id:string|null;reason:string|null}|null}
