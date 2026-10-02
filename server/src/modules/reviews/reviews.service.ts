import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { PermissionService } from '../auth/permission.service';
import { accountAvailable } from '../tasks/assignment-release';
import { reviewAuthorSql, reviewEligible, type CapacityUser, type ReviewTask } from '../tasks/review-assignment';
import { readAnnotationObjects, latestReview } from '../annotations/annotation-read';
import { integer, uuid } from '../annotations/annotation-input';
import { WorkbenchService } from '../workbench/workbench.service';
import { parseReview } from './review-input';

@Injectable()
export class ReviewsService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db:DataSource,private readonly workbench:WorkbenchService) {}
  async read(actor:AuthUser,caseId:string,versionValue:unknown,ip:string){
    const id=uuid(caseId);
    if(versionValue!==undefined&&(typeof versionValue!=='string'||!/^(0|[1-9]\d*)$/.test(versionValue)))throw new BadRequestException('版本号无效');
    const requested=versionValue===undefined?undefined:integer(Number(versionValue));
    return this.db.transaction(async manager=>{
      const context=await this.context(manager,actor,id);
      const version=requested??context.item.annotation_version;
      if(version>context.item.annotation_version)throw new NotFoundException('标注版本不存在');
      if(version>0){
        const [record]=await manager.query(`SELECT EXISTS(SELECT 1 FROM annotation_objects WHERE case_id=$1 AND version=$2)
          OR EXISTS(SELECT 1 FROM audit_logs WHERE target='cases:'||$1::text AND action='annotations.saved' AND detail->>'version'=$2::text) AS found`,[id,version]);
        if(!record.found)throw new NotFoundException('标注版本不存在');
      }
      const data=await this.workbench.readInTransaction(manager,context.user,id,ip,'review');
      const [disease]=await manager.query('SELECT id,name FROM taxonomy_nodes WHERE id=$1 AND deleted_at IS NULL',[context.item.disease_tag_id]);
      const annotations=await readAnnotationObjects(manager,id,version);
      const latest_review=await latestReview(manager,id);
      await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(context.user,id,context.item.system_code,'review');
      await this.audit(manager,actor.id,'reviews.viewed',id,{version},ip);
      return {...data,disease:disease??null,review_mode:context.task.review_mode,version,current_version:context.item.annotation_version,annotations,latest_review};
    });
  }
  async decide(actor:AuthUser,caseId:string,body:unknown,ip:string){
    const id=uuid(caseId),input=parseReview(body);
    return this.db.transaction(async manager=>{
      // Same fixed user -> task -> case order as submit and all capacity mutations.
      const users=await manager.query('SELECT *,expire_at::text FROM users WHERE deleted_at IS NULL ORDER BY id FOR NO KEY UPDATE') as CapacityUser[];
      const context=await this.context(manager,actor,id,input.expected_version);
      if(context.item.annotation_version!==input.expected_version)throw new ConflictException('标注版本已变化，请重新读取');
      const annotations=await readAnnotationObjects(manager,id,input.expected_version) as {id:string;is_gold:boolean}[];
      if(annotations.some(a=>a.is_gold))throw new ConflictException('金标准版本已锁定');
      for(const comment of input.comments)if(comment.kind==='object'&&!annotations.some(a=>a.id===comment.annotation_id))throw new BadRequestException('批注对象不属于当前病例版本');
      if(input.result==='通过')await this.assertDisease(manager,context.item.disease_tag_id,context.item.system_code);
      const active=await manager.query("SELECT id,task_role,assignee_id FROM task_assignments WHERE case_id=$1 AND state='active' AND deleted_at IS NULL FOR UPDATE",[id]);
      if(active.length!==1||active[0].task_role!=='review'||active[0].assignee_id!==actor.id)throw new ConflictException('审核分派已变化');
      // Check again after locks/reference reads; elapsed deadlines never gain authority.
      await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(context.user,id,context.item.system_code,'review');
      const [clock]=await manager.query('SELECT clock_timestamp() AS now');
      const comments=input.comments.map(c=>({...c,reviewer_id:actor.id,created_at:clock.now.toISOString(),annotation_version:input.expected_version}));
      const [review]=await manager.query(`INSERT INTO reviews(case_id,reviewer_id,result,comments,is_spotcheck)
        VALUES($1,$2,$3,$4::jsonb,false) RETURNING id`,[id,actor.id,input.result,JSON.stringify(comments)]);
      await manager.query("UPDATE task_assignments SET state='completed',updated_at=now() WHERE id=$1",[active[0].id]);
      let reannotation:{assignment_id:string|null;assignee_id:string|null;reason:string|null}|null=null;
      let status='已发布';
      if(input.result==='通过'){
        await manager.query('UPDATE annotation_objects SET is_gold=true,updated_at=now() WHERE case_id=$1 AND version=$2 AND deleted_at IS NULL',[id,input.expected_version]);
      }else{
        const original=users.find(u=>u.id===context.item.author);
        let reason:string|null=!original||!accountAvailable(original)?'account_unavailable':
          !original.quals[context.task.system_code]?.includes('annotate')||(context.task.review_mode==='self'&&!original.quals[context.task.system_code]?.includes('review'))?'qualification_removed':null;
        if(!reason&&original){
          const [load]=await manager.query(`SELECT count(*)::int global_count,count(*) FILTER(WHERE tc.task_id=$2)::int task_count FROM task_assignments a
            JOIN task_cases tc ON tc.case_id=a.case_id AND tc.deleted_at IS NULL JOIN tasks t ON t.id=tc.task_id AND t.deleted_at IS NULL AND t.status='进行中'
            JOIN cases c ON c.id=a.case_id AND c.deleted_at IS NULL WHERE a.assignee_id=$1 AND a.state='active'
              AND a.deleted_at IS NULL AND (a.due_at IS NULL OR a.due_at>clock_timestamp())`,[original.id,context.task.id]);
          if((original.in_flight_limit!==null&&load.global_count>=original.in_flight_limit)||
            (context.task.in_flight_limit!==null&&load.task_count>=context.task.in_flight_limit))reason='capacity_full';
        }
        if(reason){status='待分配';reannotation={assignment_id:null,assignee_id:null,reason};}
        else{
          const [assignment]=await manager.query("INSERT INTO task_assignments(case_id,assignee_id,task_role,due_at,state) VALUES($1,$2,'annotate',NULL,'active') RETURNING id",[id,original!.id]);
          status='标注中';reannotation={assignment_id:assignment.id,assignee_id:original!.id,reason:null};
        }
      }
      await manager.query('UPDATE cases SET status=$2,updated_at=now() WHERE id=$1',[id,status]);
      const detail={review_id:review.id,version:input.expected_version,result:input.result,task_id:context.task.id,from:'审核中',to:status,reannotation};
      await this.audit(manager,actor.id,'reviews.decided',id,detail,ip);
      if(input.result==='通过')await this.audit(manager,actor.id,'cases.published',id,{review_id:review.id,version:input.expected_version},ip);
      return {review_id:review.id,case_id:id,version:input.expected_version,status,is_gold:input.result==='通过',reannotation};
    });
  }
  private async context(manager:EntityManager,actor:AuthUser,id:string,expected?:number){
    const [user]=await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE',[actor.id]) as CapacityUser[];
    if(!user||!accountAvailable(user)||user.updated_at.getTime()!==actor.updated_at.getTime())throw new ForbiddenException('账号或会话已失效');
    const [task]=await manager.query(`SELECT t.* FROM tasks t JOIN task_cases tc ON tc.task_id=t.id AND tc.deleted_at IS NULL
      WHERE tc.case_id=$1 AND t.deleted_at IS NULL AND t.status='进行中' AND EXISTS(SELECT 1 FROM task_assignments a
        WHERE a.case_id=$1 AND a.assignee_id=$2 AND a.task_role='review' AND a.deleted_at IS NULL) FOR NO KEY UPDATE OF t`,[id,user.id]) as ReviewTask[];
    if(!task)throw new ForbiddenException('审核病例不可访问');
    new PermissionService(manager as unknown as DataSource).assertQualification(user,task.system_code,'review');
    const [item]=await manager.query(`SELECT c.*,${reviewAuthorSql} author FROM cases c JOIN task_cases tc ON tc.case_id=c.id AND tc.deleted_at IS NULL
      JOIN tasks t ON t.id=tc.task_id WHERE c.id=$1 AND c.deleted_at IS NULL AND c.source='synthetic' AND EXISTS(
        SELECT 1 FROM audit_logs WHERE target='cases:'||c.id::text AND action IN ('case_import.deidentification_confirmed','case_manual.confirmed')) FOR UPDATE OF c`,[id]);
    if(!item||!reviewEligible(user,task,item.author))throw new ForbiddenException('审核病例不可访问');
    if(item.status!=='审核中'){
      const last=expected===undefined?null:await latestReview(manager,id);
      if(last?.reviewer_id===user.id&&last.comments.some((c:{annotation_version:number})=>c.annotation_version===expected))throw new ConflictException('审核结论已提交，请刷新任务列表');
      throw new ForbiddenException('病例无有效审核分派');
    }
    await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(user,id,item.system_code,'review');
    return {user,task,item};
  }
  private async assertDisease(manager:EntityManager,id:string|null,system:string){
    const names:Record<string,string>={cns:'中枢神经系统',headneck:'头颈',resp:'呼吸',circ:'循环',digest:'消化',uro:'泌尿',repro:'生殖',bone:'骨骼'};
    const [node]=await manager.query(`SELECT n.id FROM taxonomy_nodes n JOIN taxonomy_nodes p ON p.id=n.parent_id
      LEFT JOIN taxonomy_nodes g ON g.id=p.parent_id LEFT JOIN taxonomy_nodes r ON r.id=g.parent_id
      WHERE n.id=$1 AND n.deleted_at IS NULL AND p.deleted_at IS NULL AND g.deleted_at IS NULL
        AND ((n.level=3 AND p.level=2 AND g.level=1 AND g.name=$2)
          OR (n.level=4 AND p.level=3 AND g.level=2 AND r.level=1 AND r.deleted_at IS NULL AND r.name=$2))
      FOR SHARE OF n,p`,[id,names[system]]);
    if(!node)throw new BadRequestException('疾病标签缺失、失效或不属于当前系统，必须打回');
  }
  private async audit(manager:EntityManager,actor:string,action:string,id:string,detail:Record<string,unknown>,ip:string){
    await manager.query('INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,$2,$3,$4::jsonb,$5)',[actor,action,`cases:${id}`,JSON.stringify(detail),ip]);
  }
}
