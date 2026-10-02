import type { EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';

export type ReleaseUser = Pick<AuthUser, 'id' | 'role' | 'quals' | 'status' | 'expire_at' | 'must_change_password' | 'mfa_secret_encrypted'>;
export function accountAvailable(user: ReleaseUser): boolean {
  return user.status === 'active' && user.expire_at >= new Date().toISOString().slice(0, 10) &&
    !user.must_change_password && (user.role !== 'admin' || !!user.mfa_secret_encrypted);
}

// Caller must hold the assignee user row lock. Keep users -> tasks -> cases -> assignments order.
// Review release returns to pending review and preserves annotation versions.
export async function releaseIneligibleAnnotations(manager: EntityManager, user: ReleaseUser, actor: string | null, ip: string) {
  const tasks = await manager.query(`SELECT t.id,t.source,t.system_code,t.review_mode,t.dispatch_mode FROM tasks t
    WHERE t.deleted_at IS NULL AND t.status='进行中' AND EXISTS (
      SELECT 1 FROM task_cases tc JOIN task_assignments a ON a.case_id=tc.case_id
      WHERE tc.task_id=t.id AND tc.deleted_at IS NULL AND a.assignee_id=$1
        AND a.task_role IN ('annotate','review') AND a.state='active' AND a.deleted_at IS NULL)
    ORDER BY t.id FOR UPDATE`, [user.id]);
  const cases = await manager.query(`SELECT c.id,c.source,c.system_code,c.status,tc.task_id FROM cases c
    JOIN task_cases tc ON tc.case_id=c.id AND tc.deleted_at IS NULL
    WHERE tc.task_id=ANY($1::uuid[]) AND c.deleted_at IS NULL AND c.status IN ('标注中','待审核','审核中')
      AND EXISTS (SELECT 1 FROM task_assignments a WHERE a.case_id=c.id AND a.assignee_id=$2
        AND a.task_role IN ('annotate','review') AND a.state='active' AND a.deleted_at IS NULL)
    ORDER BY c.id FOR UPDATE OF c`, [tasks.map((t: { id: string }) => t.id), user.id]);
  const released: { assignment_id: string; case_id: string; task_id: string; reason: string }[] = [];
  for (const item of cases) {
    const task = tasks.find((t: { id: string }) => t.id === item.task_id);
    if (task.source !== item.source || task.system_code !== item.system_code) continue;
    const [assignment] = await manager.query(`SELECT id,task_role,(due_at IS NOT NULL AND due_at<=clock_timestamp()) expired
      FROM task_assignments WHERE case_id=$1 AND assignee_id=$2 AND task_role=CASE WHEN $3='标注中' THEN 'annotate' ELSE 'review' END
        AND state='active' AND deleted_at IS NULL FOR UPDATE`, [item.id, user.id,item.status]);
    if (!assignment) continue;
    const qualified = user.quals[task.system_code]?.includes(assignment.task_role) &&
      (task.review_mode !== 'self' || user.quals[task.system_code]?.includes(assignment.task_role==='annotate'?'review':'annotate'));
    const reason = !accountAvailable(user) ? 'account_unavailable' : !qualified ? 'qualification_removed' : assignment.expired ? 'deadline_expired' : null;
    if (!reason) continue;
    await manager.query("UPDATE task_assignments SET state='released',updated_at=now() WHERE id=$1", [assignment.id]);
    const to=assignment.task_role==='review'?'待审核':'待分配';
    await manager.query('UPDATE cases SET status=$2,updated_at=now() WHERE id=$1',[item.id,to]);
    const result = { assignment_id: assignment.id as string, case_id: item.id as string, task_id: task.id as string, reason };
    await manager.query(`INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES ($1,'tasks.assignment_released',$2,$3::jsonb,$4)`,
      [actor, `tasks:${task.id}`, JSON.stringify({ ...result, ...(actor === null ? { executor: 'task-worker' } : {}), assignee_id: user.id, task_role:assignment.task_role,from:item.status,to }), ip]);
    released.push(result);
  }
  return released;
}
