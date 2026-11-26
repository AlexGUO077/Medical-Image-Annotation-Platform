import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { accountAvailable } from '../tasks/assignment-release';

export async function educationActor(manager:EntityManager,actor:AuthUser,role:'admin'|'student') {
  const [current]=await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE',[actor.id]) as AuthUser[];
  if(!current||current.role!==role||!accountAvailable(current)||current.updated_at.getTime()!==actor.updated_at.getTime())throw new ForbiddenException('身份或会话不可用');
  return current;
}
/** Caller locks and rechecks the user first. Resource locks remain held through the response transaction. */
export async function educationContext(manager:EntityManager,studentId:string,attemptId:string,caseId?:string,seriesId?:string) {
  const [context]=await manager.query(`SELECT a.id,a.item_id,a.student_id,a.state,a.version,a.answer,a.submitted_at,
    i.case_id,i.ordinal,i.series_ids,i.reference_version,t.id task_id,t.title,t.instructions,t.status task_status
    FROM education_attempts a JOIN education_items i ON i.id=a.item_id AND i.deleted_at IS NULL
    JOIN education_tasks t ON t.id=i.task_id AND t.deleted_at IS NULL
    JOIN education_students es ON es.task_id=t.id AND es.deleted_at IS NULL
    JOIN education_roster r ON r.id=es.roster_id AND r.user_id=a.student_id AND r.deleted_at IS NULL
    JOIN cases c ON c.id=i.case_id AND c.deleted_at IS NULL
    WHERE a.id=$1 AND a.student_id=$2 AND a.deleted_at IS NULL
      AND t.status<>'revoked' AND (t.status='published' OR a.state='submitted')
      AND c.status<>'已下线' AND c.source IN ('synthetic','teacher_provided_teaching')
      AND EXISTS(SELECT 1 FROM audit_logs WHERE target='cases:'||c.id::text AND action IN ('case_import.deidentification_confirmed','case_manual.confirmed'))
    FOR SHARE OF t,i,es,r,c`,[attemptId,studentId]);
  if(!context||(caseId&&context.case_id!==caseId)||(seriesId&&!context.series_ids.includes(seriesId)))throw new ForbiddenException('考核资源不可访问');
  return context;
}
