import type { EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { accountAvailable } from './assignment-release';
export type CapacityUser=AuthUser&{in_flight_limit:number|null};
export interface ReviewTask {id:string;system_code:string;review_mode:string;dispatch_mode:string;in_flight_limit:number|null}
// The submitting actor is authoritative even for an empty annotation version.
export const reviewAuthorSql=`(SELECT l.actor FROM audit_logs l WHERE l.target='cases:'||c.id::text AND l.action='annotations.submitted'
  AND l.detail->>'task_id'=t.id::text AND l.detail->>'version'=c.annotation_version::text ORDER BY l.created_at DESC,l.id DESC LIMIT 1)`;
export function reviewEligible(user:CapacityUser,task:ReviewTask,author:string|null):boolean {
 return !!author&&accountAvailable(user)&&!!user.quals[task.system_code]?.includes('review')&&
  (task.review_mode==='self'?user.id===author&&!!user.quals[task.system_code]?.includes('annotate'):user.id!==author);
}
/** Caller holds all candidate user locks, then task and case. */
export async function assignSubmittedReview(manager:EntityManager,users:CapacityUser[],task:ReviewTask,caseId:string,author:string){
 if(task.review_mode!=='self'&&task.dispatch_mode!=='auto')return {assignment_id:null,assignee_id:null,reason:task.dispatch_mode==='manual'?'manual_dispatch':'review_pool'};
 const eligible=users.filter(u=>reviewEligible(u,task,author));
 const loads=await manager.query(`SELECT a.assignee_id,count(*)::int global_count,count(*) FILTER(WHERE tc.task_id=$1)::int task_count
 FROM task_assignments a JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL
 JOIN tasks t ON t.id=tc.task_id AND t.deleted_at IS NULL AND t.status='进行中'
 JOIN cases c ON c.id=a.case_id AND c.deleted_at IS NULL
 WHERE a.state='active' AND a.deleted_at IS NULL AND (a.due_at IS NULL OR a.due_at>clock_timestamp()) GROUP BY a.assignee_id`,[task.id]);
 const load=(id:string)=>loads.find((l:{assignee_id:string})=>l.assignee_id===id)??{global_count:0,task_count:0};
 const available=eligible.filter(u=>(u.in_flight_limit===null||load(u.id).global_count<u.in_flight_limit)&&
  (task.in_flight_limit===null||load(u.id).task_count<task.in_flight_limit));
 available.sort((a,b)=>load(a.id).global_count-load(b.id).global_count||load(a.id).task_count-load(b.id).task_count||a.id.localeCompare(b.id));
 const chosen=available[0];
 if(!chosen)return {assignment_id:null,assignee_id:null,reason:eligible.length?'capacity_full':'no_eligible_assignee'};
 const [assignment]=await manager.query("INSERT INTO task_assignments(case_id,assignee_id,task_role,due_at,state) VALUES($1,$2,'review',NULL,'active') RETURNING id",[caseId,chosen.id]);
 return {assignment_id:assignment.id as string,assignee_id:chosen.id,reason:null};
}
