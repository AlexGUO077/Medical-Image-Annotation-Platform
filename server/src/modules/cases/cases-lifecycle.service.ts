import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { accountAvailable } from '../tasks/assignment-release';
import { integer, object, uuid } from '../annotations/annotation-input';

@Injectable()
export class CasesLifecycleService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db:DataSource) {}
  async change(actor:AuthUser,caseId:string,body:unknown,action:'offline'|'reactivate',ip:string){
    const id=uuid(caseId),expected=integer(object(body,['expected_version']).expected_version);
    return this.db.transaction(async manager=>{
      // Copying preserved authors also checks user FKs. Match submit/dispatch lock order.
      await manager.query('SELECT id FROM users WHERE deleted_at IS NULL ORDER BY id FOR NO KEY UPDATE');
      await this.admin(manager,actor);
      const tasks=await manager.query(`SELECT t.* FROM tasks t JOIN task_cases tc ON tc.task_id=t.id
        WHERE tc.case_id=$1 AND tc.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY t.id FOR NO KEY UPDATE OF t`,[id]);
      const [item]=await manager.query(`SELECT c.*,EXISTS(SELECT 1 FROM audit_logs WHERE target='cases:'||c.id::text
        AND action IN ('case_import.deidentification_confirmed','case_manual.confirmed')) confirmed
        FROM cases c WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,[id]);
      if(!item)throw new NotFoundException('病例不存在');
      if(item.source!=='synthetic'||!item.confirmed)throw new ForbiddenException('病例尚不允许此操作');
      const from=action==='offline'?'已发布':'已下线',status=action==='offline'?'已下线':'待分配';
      if(item.status!==from||item.annotation_version!==expected)throw new ConflictException('病例状态或版本已变化，请重新读取');
      const task=tasks[0];
      if(action==='reactivate'&&(tasks.length!==1||task.status!=='进行中'||task.source!==item.source||task.system_code!==item.system_code))
        throw new ConflictException('原任务不可用，请由管理员处理后重试');
      if(action==='reactivate'&&expected===2147483647)throw new ConflictException('标注版本已达到存储上限');
      const active=await manager.query("SELECT id,assignee_id,task_role FROM task_assignments WHERE case_id=$1 AND state='active' AND deleted_at IS NULL ORDER BY id FOR UPDATE",[id]);
      if(action==='reactivate'&&active.length)throw new ConflictException('病例存在残留在途分派，请先处理');
      const version=action==='reactivate'?expected+1:expected;
      let objectCount=0;
      if(action==='reactivate'){
        const copied=await manager.query(`INSERT INTO annotation_objects(case_id,logical_id,series_id,tool,geometry,frame_start,frame_end,
          key_frame_index,window_preset,report_sent_ids,part_id,confidence,measurements,version,is_gold,created_by,task_id)
          SELECT case_id,logical_id,series_id,tool,geometry,frame_start,frame_end,key_frame_index,window_preset,
            report_sent_ids,part_id,confidence,measurements,$3,false,created_by,task_id FROM annotation_objects
          WHERE case_id=$1 AND version=$2 AND deleted_at IS NULL ORDER BY logical_id RETURNING id`,[id,expected,version]);
        objectCount=copied.length;
        await manager.query(`INSERT INTO annotation_tags(annotation_id,sign_tag_id)
          SELECT n.id,t.sign_tag_id FROM annotation_objects old JOIN annotation_tags t ON t.annotation_id=old.id AND t.deleted_at IS NULL
          JOIN annotation_objects n ON n.case_id=old.case_id AND n.logical_id=old.logical_id AND n.version=$3
          WHERE old.case_id=$1 AND old.version=$2 AND old.deleted_at IS NULL ORDER BY n.id,t.sign_tag_id`,[id,expected,version]);
        await this.audit(manager,actor.id,'annotations.seeded',id,{version,previous_version:expected,object_count:objectCount,reason:'reactivation'},ip);
      }else{
        for(const assignment of active){
          await manager.query("UPDATE task_assignments SET state='released',updated_at=now() WHERE id=$1",[assignment.id]);
          await this.audit(manager,actor.id,'tasks.assignment_released',id,{assignment_id:assignment.id,assignee_id:assignment.assignee_id,task_role:assignment.task_role,reason:'case_offlined'},ip);
        }
      }
      // Account expiry can cross midnight while awaiting locks/copying objects.
      await this.admin(manager,actor);
      await manager.query('UPDATE cases SET status=$2,annotation_version=$3,updated_at=now() WHERE id=$1',[id,status,version]);
      await this.audit(manager,actor.id,action==='offline'?'cases.offlined':'cases.reactivated',id,
        {from,to:status,previous_version:expected,version,task_id:task?.id??null,object_count:objectCount,released_assignments:active.length},ip);
      return {case_id:id,status,version};
    });
  }
  private async admin(manager:EntityManager,actor:AuthUser){
    const [current]=await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE',[actor.id]) as AuthUser[];
    if(!current||current.role!=='admin'||!accountAvailable(current)||current.updated_at.getTime()!==actor.updated_at.getTime())throw new ForbiddenException('管理员账号或会话已失效');
  }
  private async audit(manager:EntityManager,actor:string,action:string,id:string,detail:Record<string,unknown>,ip:string){
    await manager.query('INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,$2,$3,$4::jsonb,$5)',[actor,action,`cases:${id}`,JSON.stringify(detail),ip]);
  }
}
