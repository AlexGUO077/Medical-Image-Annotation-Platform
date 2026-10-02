import { randomInt, randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { object, uuid } from '../annotations/annotation-input';
import { accountAvailable } from './assignment-release';
import { reviewAuthorSql, type CapacityUser, type ReviewTask } from './review-assignment';

interface Target {case_id:string;version:number;author:string}
export async function qualityAudit(m:EntityManager,actor:string|null,action:string,target:string,detail:Record<string,unknown>,ip:string,id=randomUUID()){
  await m.query('INSERT INTO audit_logs(id,actor,action,target,detail,ip) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[id,actor,action,target,JSON.stringify(actor===null?{...detail,executor:'task-worker'}:detail),ip]);
}
export function qualityEligible(user:CapacityUser,task:ReviewTask,author:string|null){
  return !!author&&user.id!==author&&accountAvailable(user)&&!!user.quals[task.system_code]?.includes('review');
}
// Caller holds candidate users, task and case locks, in that order.
async function allocate(m:EntityManager,users:CapacityUser[],task:ReviewTask,target:Target,kind:'spotcheck'|'recheck',existing?:string){
  const loads=await m.query(`SELECT a.assignee_id,count(*)::int global_count,count(*) FILTER(WHERE tc.task_id=$1)::int task_count
    FROM task_assignments a JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL
    JOIN tasks t ON t.id=tc.task_id AND t.deleted_at IS NULL AND t.status='进行中'
    JOIN cases c ON c.id=a.case_id AND c.deleted_at IS NULL
    WHERE a.state='active' AND a.deleted_at IS NULL AND (a.due_at IS NULL OR a.due_at>clock_timestamp()) GROUP BY a.assignee_id`,[task.id]);
  const load=(id:string)=>loads.find((l:{assignee_id:string})=>l.assignee_id===id)??{global_count:0,task_count:0};
  const eligible=users.filter(u=>qualityEligible(u,task,target.author));
  const available=eligible.filter(u=>(u.in_flight_limit===null||load(u.id).global_count<u.in_flight_limit)&&
    (task.in_flight_limit===null||load(u.id).task_count<task.in_flight_limit));
  available.sort((a,b)=>load(a.id).global_count-load(b.id).global_count||load(a.id).task_count-load(b.id).task_count||a.id.localeCompare(b.id));
  const user=available[0],state=user?'active':'pending';
  let id=existing;
  if(existing)await m.query('UPDATE task_assignments SET assignee_id=$2,state=$3,due_at=NULL,started_at=NULL,updated_at=now() WHERE id=$1',[existing,user?.id??null,state]);
  else {const [row]=await m.query(`INSERT INTO task_assignments(case_id,assignee_id,task_role,state,review_kind,review_version)
    VALUES($1,$2,'review',$3,$4,$5) RETURNING id`,[target.case_id,user?.id??null,state,kind,target.version]);id=row.id;}
  return {assignment_id:id!,case_id:target.case_id,version:target.version,assignee_id:user?.id??null,state};
}

export async function decideQuality(m:EntityManager,users:CapacityUser[],task:ReviewTask,item:{id:string;annotation_version:number;author:string},assignment:{id:string;review_kind:'spotcheck'|'recheck'},result:string,actor:string,ip:string){
  let assigned_count=0,pending_count=0;
  if(result==='通过')return {assigned_count,pending_count};
  await m.query("UPDATE cases SET status='已下线',updated_at=now() WHERE id=$1",[item.id]);
  await qualityAudit(m,actor,'cases.offlined',`cases:${item.id}`,{from:'已发布',to:'已下线',version:item.annotation_version,assignment_id:assignment.id,reason:assignment.review_kind},ip);
  if(assignment.review_kind!=='spotcheck')return {assigned_count,pending_count};
  const [batch]=await m.query(`SELECT id,detail FROM audit_logs WHERE action='tasks.spotchecks_created' AND target=$1
    AND detail->'assignments' @> $2::jsonb ORDER BY created_at,id LIMIT 1`,[`tasks:${task.id}`,JSON.stringify([{assignment_id:assignment.id}])]);
  if(!batch)throw new ConflictException('抽检轮次不存在');
  const [expanded]=await m.query(`SELECT id FROM audit_logs WHERE action='tasks.quality_expanded' AND target=$1
    AND detail->>'batch_id'=$2 AND detail->>'author'=$3`,[`tasks:${task.id}`,batch.id,item.author]);
  if(expanded)return {assigned_count,pending_count};
  const targets=(batch.detail.candidates as Target[]).filter(t=>t.author===item.author&&t.case_id!==item.id);
  const cases=await m.query(`SELECT c.id,c.annotation_version,c.status,${reviewAuthorSql} author FROM cases c
    JOIN task_cases tc ON tc.case_id=c.id AND tc.deleted_at IS NULL JOIN tasks t ON t.id=tc.task_id
    WHERE c.id=ANY($1::uuid[]) AND t.id=$2 AND c.deleted_at IS NULL AND c.source=t.source AND c.system_code=t.system_code ORDER BY c.id FOR UPDATE OF c`,[targets.map(t=>t.case_id),task.id]);
  const assignments=[];
  for(const target of targets){
    if(!cases.some((c:{id:string;annotation_version:number;status:string;author:string})=>c.id===target.case_id&&c.annotation_version===target.version&&c.status==='已发布'&&c.author===target.author))continue;
    const prior=await m.query(`SELECT id FROM task_assignments WHERE case_id=$1 AND review_version=$2 AND review_kind<>'normal'
      AND deleted_at IS NULL AND (state IN ('active','pending') OR (state='completed' AND EXISTS(
        SELECT 1 FROM audit_logs l WHERE l.action='reviews.decided' AND l.detail->>'assignment_id'=task_assignments.id::text AND l.detail->>'result'='通过')))`,[target.case_id,target.version]);
    if(prior.length)continue;
    const entry=await allocate(m,users,task,target,'recheck');assignments.push(entry);
    if(entry.state==='active')assigned_count++;else pending_count++;
  }
  await qualityAudit(m,actor,'tasks.quality_expanded',`tasks:${task.id}`,{batch_id:batch.id,author:item.author,assignment_id:assignment.id,assignments,assigned_count,pending_count},ip);
  return {assigned_count,pending_count};
}

@Injectable()
export class QualityReviewsService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db:DataSource){}
  async sample(actor:AuthUser,taskId:string,body:unknown,ip:string){
    const id=uuid(taskId);object(body,[]);
    return this.db.transaction(async m=>{
      const users=await this.users(m),current=users.find(u=>u.id===actor.id);
      if(!current||current.role!=='admin'||!accountAvailable(current)||current.updated_at.getTime()!==actor.updated_at.getTime())throw new ForbiddenException('管理员账号或会话已失效');
      const [task]=await m.query("SELECT * FROM tasks WHERE id=$1 AND deleted_at IS NULL AND status='进行中' FOR UPDATE",[id]);
      if(!task)throw new NotFoundException('任务不存在或不在进行中');
      if(task.source!=='synthetic')throw new ForbiddenException('当前仅支持合成抽检');
      const candidates=await m.query(`SELECT c.id case_id,c.annotation_version version,${reviewAuthorSql} author FROM cases c
        JOIN task_cases tc ON tc.case_id=c.id AND tc.deleted_at IS NULL JOIN tasks t ON t.id=tc.task_id
        WHERE t.id=$1 AND c.deleted_at IS NULL AND c.status='已发布' AND c.source=t.source AND c.system_code=t.system_code
          AND ${reviewAuthorSql} IS NOT NULL AND EXISTS(SELECT 1 FROM audit_logs l WHERE l.target='cases:'||c.id::text
            AND l.action IN ('case_import.deidentification_confirmed','case_manual.confirmed'))
          AND NOT EXISTS(SELECT 1 FROM audit_logs l WHERE l.target='tasks:'||t.id::text AND l.action='tasks.spotchecks_created'
            AND l.detail->'candidates' @> jsonb_build_array(jsonb_build_object('case_id',c.id,'version',c.annotation_version)))
        ORDER BY c.id FOR UPDATE OF c`,[id]) as Target[];
      if(!candidates.length)return {batch_id:null,candidate_count:0,sampled_count:0,assigned_count:0,pending_count:0};
      const shuffled=[...candidates];
      for(let i=shuffled.length-1;i>0;i--){const j=randomInt(i+1);[shuffled[i],shuffled[j]]=[shuffled[j]!,shuffled[i]!];}
      const sampled=shuffled.slice(0,Math.ceil(candidates.length/10)),assignments=[];
      for(const target of sampled)assignments.push(await allocate(m,users,task,target,'spotcheck'));
      if(!accountAvailable(current))throw new ForbiddenException('管理员账号已失效');
      const batch_id=randomUUID();
      const response={batch_id,candidate_count:candidates.length,sampled_count:sampled.length,
        assigned_count:assignments.filter(a=>a.state==='active').length,pending_count:assignments.filter(a=>a.state==='pending').length};
      await qualityAudit(m,actor.id,'tasks.spotchecks_created',`tasks:${id}`,{...response,candidates,assignments},ip,batch_id);
      return response;
    });
  }
  async start(actor:AuthUser,taskId:string,caseId:string,assignmentId:unknown,ip:string){
    const id=uuid(assignmentId);
    return this.db.transaction(async m=>{
      const users=await this.users(m),user=users.find(u=>u.id===actor.id);
      if(!user||user.updated_at.getTime()!==actor.updated_at.getTime())throw new ForbiddenException('会话已失效');
      const [task]=await m.query("SELECT * FROM tasks WHERE id=$1 AND deleted_at IS NULL AND status='进行中' FOR UPDATE",[taskId]);
      const [item]=await m.query(`SELECT c.*,${reviewAuthorSql} author FROM cases c JOIN task_cases tc ON tc.case_id=c.id AND tc.deleted_at IS NULL
        JOIN tasks t ON t.id=tc.task_id WHERE c.id=$1 AND t.id=$2 AND c.deleted_at IS NULL FOR UPDATE OF c`,[caseId,taskId]);
      if(!task||!item||item.status!=='已发布'||item.source!=='synthetic'||item.source!==task.source||item.system_code!==task.system_code)throw new ConflictException('质量审核目标已变化');
      if(!qualityEligible(user,task,item.author))throw new ForbiddenException('抽检必须由其他合格人员审核');
      const [a]=await m.query(`SELECT * FROM task_assignments WHERE id=$1 AND case_id=$2 AND assignee_id=$3 AND state='active'
        AND review_kind<>'normal' AND deleted_at IS NULL AND (due_at IS NULL OR due_at>clock_timestamp()) FOR UPDATE`,[id,caseId,actor.id]);
      if(!a||a.review_version!==item.annotation_version)throw new ForbiddenException('质量审核未有效分派');
      if(a.started_at)throw new ConflictException('审核已经开始，请刷新队列');
      await m.query('UPDATE task_assignments SET started_at=clock_timestamp(),updated_at=now() WHERE id=$1',[id]);
      await qualityAudit(m,actor.id,'tasks.quality_started',`tasks:${taskId}`,{case_id:caseId,assignment_id:id,version:a.review_version,review_kind:a.review_kind},ip);
      return {case_id:caseId,status:'已发布'};
    });
  }
  async maintain(){
    const [work]=await this.db.query("SELECT EXISTS(SELECT 1 FROM task_assignments WHERE review_kind<>'normal' AND state IN ('active','pending') AND deleted_at IS NULL) found");
    if(!work.found)return;
    await this.db.transaction(async m=>{
      const users=await this.users(m);
      const tasks=await m.query('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY id FOR UPDATE');
      const items=await m.query(`SELECT c.*,tc.task_id,${reviewAuthorSql} author FROM cases c JOIN task_cases tc ON tc.case_id=c.id AND tc.deleted_at IS NULL
        JOIN tasks t ON t.id=tc.task_id WHERE EXISTS(SELECT 1 FROM task_assignments a WHERE a.case_id=c.id AND a.review_kind<>'normal'
          AND a.state IN ('pending','active') AND a.deleted_at IS NULL) ORDER BY c.id FOR UPDATE OF c`);
      for(const item of items){
        const task=tasks.find((t:ReviewTask)=>t.id===item.task_id);
        const assignments=await m.query(`SELECT *,due_at IS NOT NULL AND due_at<=clock_timestamp() expired FROM task_assignments
          WHERE case_id=$1 AND review_kind<>'normal' AND state IN ('pending','active') AND deleted_at IS NULL ORDER BY id FOR UPDATE`,[item.id]);
        for(const a of assignments){
          if(!task||task.status!=='进行中'||item.deleted_at||item.source!=='synthetic'||item.source!==task.source||item.system_code!==task.system_code||item.status!=='已发布'||item.annotation_version!==a.review_version||!item.author){
            await m.query("UPDATE task_assignments SET state='cancelled',started_at=NULL,updated_at=now() WHERE id=$1",[a.id]);
            await qualityAudit(m,null,'tasks.assignment_released',`cases:${item.id}`,{assignment_id:a.id,version:a.review_version},'system');continue;
          }
          if(a.state==='active'&&!a.expired&&users.some(u=>u.id===a.assignee_id&&qualityEligible(u,task,item.author)))continue;
          const previous=a.assignee_id;
          if(a.state==='active')await m.query("UPDATE task_assignments SET state='pending',assignee_id=NULL,started_at=NULL,due_at=NULL,updated_at=now() WHERE id=$1",[a.id]);
          const allocated=await allocate(m,users,task,{case_id:item.id,version:a.review_version,author:item.author},a.review_kind,a.id);
          if(previous||allocated.assignee_id)await qualityAudit(m,null,allocated.assignee_id?'tasks.auto_dispatched':'tasks.assignment_released',`tasks:${task.id}`,{...allocated,previous_assignee_id:previous,review_kind:a.review_kind},'system');
        }
      }
    });
  }
  private users(m:EntityManager){return m.query('SELECT *,expire_at::text FROM users WHERE deleted_at IS NULL ORDER BY id FOR UPDATE') as Promise<CapacityUser[]>;}
}
