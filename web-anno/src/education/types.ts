import type { Annotation } from '../annotations/types';
import type { Series } from '../viewer/api';
export interface StudentObject extends Annotation { organ:string; description:string }
export interface StudentAnswer { body_part_id:string|null; normal:boolean; findings:string; impression:string; objects:StudentObject[] }
export interface EducationAttempt {id:string;state:'in_progress'|'submitted';version:number;answer:StudentAnswer;submitted_at:string|null}
export interface EducationWorkbench {
  attempt:EducationAttempt;item:{id:string;case_id:string;ordinal:number};
  task:{title:string;instructions:string;status:string};series:Series[];
  parts:{id:string;name:string}[];signs:{id:string;name:string}[];
}
export interface EducationFeedback extends EducationWorkbench {
  reference:{report:string;annotations:Annotation[];part_names:string[];version:number};
}
export interface EducationTask {id:string;title:string;instructions:string;status:string;items:{id:string;ordinal:number;attempt_id:string|null;state:string|null}[]}
export interface RosterEntry {id:string;student_no:string;real_name:string;class_name:string;expire_at:string;activated_at:string|null;user_id:string|null}
