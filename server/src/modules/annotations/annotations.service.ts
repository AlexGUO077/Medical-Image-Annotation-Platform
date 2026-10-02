import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { accountAvailable } from '../tasks/assignment-release';
import { OrthancService } from '../cases/orthanc.service';
import { parseAnnotations, integer, uuid, REPORT_NOT_MENTIONED, object, type AnnotationInput } from './annotation-input';

import { readAnnotationObjects, latestReview } from './annotation-read';
import { SubmissionValidationException } from '../../common/submission-validation.exception';
import { submissionIssues, type SubmissionSentence } from './submission-check';
import { assignSubmittedReview, type CapacityUser } from '../tasks/review-assignment';

const ROOT_NAMES: Record<string, string> = { cns:'中枢神经系统', headneck:'头颈', resp:'呼吸', circ:'循环', digest:'消化', uro:'泌尿', repro:'生殖', bone:'骨骼' };
interface Context { user: AuthUser; item: { id: string; system_code: string; annotation_version: number }; taskId: string }
@Injectable()
export class AnnotationsService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource, private readonly orthanc: OrthancService) {}

  async save(actor: AuthUser, caseId: string, body: unknown, ip: string) {
    const id = uuid(caseId), input = parseAnnotations(body);
    return this.db.transaction(async manager => {
      const context = await this.lockContext(manager, actor, id);
      if (context.item.annotation_version !== input.expected_version) throw new ConflictException('标注版本已变化，请重新读取后合并修改');
      if (input.expected_version === 2147483647) throw new ConflictException('标注版本已达到存储上限');
      const gold = await manager.query('SELECT id FROM annotation_objects WHERE case_id=$1 AND version=$2 AND is_gold=true LIMIT 1', [id, input.expected_version]);
      if (gold.length) throw new ConflictException('金标准版本已锁定');
      await this.validateReferences(manager, context, input.annotations);
      const version = input.expected_version + 1;
      // Case row lock serializes whole-document versions, including saves containing zero objects.
      // Old object/tag rows are never changed or soft-deleted by a later save.
      for (const annotation of input.annotations) {
        const [row] = await manager.query(`INSERT INTO annotation_objects
          (case_id,logical_id,series_id,tool,geometry,frame_start,frame_end,key_frame_index,window_preset,
           report_sent_ids,part_id,confidence,version,created_by,task_id)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15) RETURNING id`,
          [id,annotation.id,annotation.series_id,annotation.tool,JSON.stringify(annotation.geometry),annotation.frame_start,
            annotation.frame_end,annotation.key_frame_index,annotation.window_preset,JSON.stringify(annotation.report_sent_ids),
            annotation.part_id,annotation.confidence,version,actor.id,context.taskId]);
        await manager.query('INSERT INTO annotation_tags(annotation_id,sign_tag_id) SELECT $1,unnest($2::uuid[])', [row.id,annotation.sign_tag_ids]);
      }
      // Deadlines may expire while reference locks are pending. Fail before advancing the version.
      await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(context.user, id, context.item.system_code, 'annotate');
      await manager.query('UPDATE cases SET annotation_version=$2,updated_at=now() WHERE id=$1', [id,version]);
      await this.audit(manager, actor.id, 'annotations.saved', id, { version, previous_version: input.expected_version, object_count: input.annotations.length }, ip);
      return { version, annotations: await this.objects(manager, id, version) };
    });
  }

  async submit(actor:AuthUser,caseId:string,body:unknown,ip:string){
    const id=uuid(caseId),expected=integer(object(body,['expected_version']).expected_version);
    return this.db.transaction(async manager=>{
      // All users precede task/case locks: review selection and cross-task capacity must serialize.
      const users=await manager.query('SELECT *,expire_at::text FROM users WHERE deleted_at IS NULL ORDER BY id FOR NO KEY UPDATE') as CapacityUser[];
      const context=await this.lockContext(manager,actor,id);
      if(context.item.annotation_version!==expected)throw new ConflictException('标注版本已变化，请重新读取');
      const [task]=await manager.query('SELECT * FROM tasks WHERE id=$1',[context.taskId]);
      const rows=await this.objects(manager,id,expected);
      if(rows.some((a:{is_gold:boolean})=>a.is_gold))throw new ConflictException('金标准版本已锁定');
      const annotations=parseAnnotations({expected_version:expected,annotations:rows.map(({version:_version,is_gold:_gold,...a}:Record<string,unknown>)=>a)}).annotations;
      await this.validateReferences(manager,context,annotations);
      const [report]=await manager.query('SELECT sentences FROM reports WHERE case_id=$1 AND deleted_at IS NULL FOR SHARE',[id]) as {sentences:SubmissionSentence[]}[];
      if(!report)throw new BadRequestException('病例报告不存在');
      const issues=submissionIssues(annotations,report.sentences);
      if(issues.objects.length||issues.sentence_ids.length)throw new SubmissionValidationException(issues);
      await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(context.user,id,context.item.system_code,'annotate');
      if(task.review_mode==='self'&&!context.user.quals[task.system_code]?.includes('review'))throw new ForbiddenException('自审缺少审核资格，请联系管理员处理');
      const active=await manager.query("SELECT id,task_role FROM task_assignments WHERE case_id=$1 AND state='active' AND deleted_at IS NULL FOR UPDATE",[id]);
      if(active.length!==1||active[0].task_role!=='annotate')throw new ConflictException('病例分派已变化');
      await manager.query("UPDATE task_assignments SET state='completed',updated_at=now() WHERE id=$1",[active[0].id]);
      await manager.query("UPDATE cases SET status='待审核',updated_at=now() WHERE id=$1",[id]);
      const review=await assignSubmittedReview(manager,users,task,id,actor.id);
      await this.audit(manager,actor.id,'annotations.submitted',id,{version:expected,object_count:annotations.length,task_id:task.id,review,from:'标注中',to:'待审核'},ip);
      return {case_id:id,version:expected,status:'待审核',review};
    });
  }

  async read(actor: AuthUser, caseId: string, versionValue: unknown, ip: string) {
    const id = uuid(caseId);
    if (versionValue !== undefined && (typeof versionValue !== 'string' || !/^(0|[1-9]\d*)$/.test(versionValue))) throw new BadRequestException('版本号无效');
    const requested = versionValue === undefined ? undefined : integer(Number(versionValue));
    return this.db.transaction(async manager => {
      const context = await this.lockContext(manager, actor, id);
      const current = context.item.annotation_version, version = requested ?? current;
      if (version > current) throw new NotFoundException('标注版本不存在');
      if (version > 0) {
        const [recorded] = await manager.query("SELECT EXISTS(SELECT 1 FROM annotation_objects WHERE case_id=$1 AND version=$2) OR EXISTS(SELECT 1 FROM audit_logs WHERE target='cases:'||$1::text AND action IN ('annotations.saved','annotations.seeded') AND detail->>'version'=$2::text) AS found", [id,version]);
        if (!recorded.found) throw new NotFoundException('标注版本不存在');
      }
      const annotations = await this.objects(manager, id, version);
      await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(context.user, id, context.item.system_code, 'annotate');
      await this.audit(manager, actor.id, 'annotations.viewed', id, { version }, ip);
      return { version, current_version: current, annotations, latest_review: await latestReview(manager,id) };
    });
  }

  private async lockContext(manager: EntityManager, actor: AuthUser, id: string): Promise<Context> {
    // Same user -> task -> case order as assignment release. NO KEY UPDATE also permits audit FK checks.
    const [user] = await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE', [actor.id]) as AuthUser[];
    if (!user || !accountAvailable(user) || user.updated_at.getTime() !== actor.updated_at.getTime()) throw new ForbiddenException('账号或会话已失效');
    const [task] = await manager.query(`SELECT t.id,t.system_code FROM tasks t JOIN task_cases tc ON tc.task_id=t.id
      WHERE tc.case_id=$1 AND tc.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status='进行中' AND EXISTS(SELECT 1 FROM task_assignments a WHERE a.case_id=tc.case_id
        AND a.assignee_id=$2 AND a.task_role='annotate' AND a.state='active' AND a.deleted_at IS NULL)
      ORDER BY t.id FOR NO KEY UPDATE OF t`, [id,user.id]);
    if (!task) throw new ForbiddenException('标注病例不可访问');
    new PermissionService(manager as unknown as DataSource).assertQualification(user, task.system_code, 'annotate');
    const [item] = await manager.query(`SELECT c.id,c.system_code,c.annotation_version FROM cases c WHERE c.id=$1
      AND c.deleted_at IS NULL AND c.source='synthetic' AND EXISTS(SELECT 1 FROM audit_logs
        WHERE target='cases:'||c.id::text AND action IN ('case_import.deidentification_confirmed','case_manual.confirmed')) FOR UPDATE`, [id]);
    if (!task || !item) throw new ForbiddenException('标注病例不可访问');
    await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(user, id, item.system_code, 'annotate');
    return { user, item, taskId: task.id };
  }

  private async validateReferences(manager: EntityManager, context: Context, annotations: AnnotationInput[]) {
    const seriesIds = [...new Set(annotations.map(a => a.series_id))].sort();
    const series = await manager.query(`SELECT s.id,s.modality,s.frame_count,s.orthanc_id,s.series_uid FROM series s JOIN studies st ON st.id=s.study_id
      WHERE st.case_id=$1 AND st.deleted_at IS NULL AND s.deleted_at IS NULL AND s.id=ANY($2::uuid[])
      ORDER BY s.id FOR SHARE OF s,st`, [context.item.id,seriesIds]) as { id:string; modality:string; frame_count:number; orthanc_id:string; series_uid:string }[];
    const partIds = [...new Set(annotations.flatMap(a => a.part_id ? [a.part_id] : []))].sort();
    const parts = await manager.query(`SELECT n.id FROM taxonomy_nodes n JOIN taxonomy_nodes root ON root.id=n.parent_id
      WHERE n.id=ANY($1::uuid[]) AND n.level=2 AND n.deleted_at IS NULL AND root.level=1
        AND root.deleted_at IS NULL AND root.name=$2 ORDER BY n.id FOR SHARE OF n`, [partIds,ROOT_NAMES[context.item.system_code]]) as { id:string }[];
    const signIds = [...new Set(annotations.flatMap(a => a.sign_tag_ids))].sort();
    const signs = await manager.query(`SELECT id FROM sign_tags WHERE id=ANY($1::uuid[]) AND system_code=$2
      AND deleted_at IS NULL ORDER BY id FOR SHARE`, [signIds,context.item.system_code]) as { id:string }[];
    if (series.length !== seriesIds.length || parts.length !== partIds.length || signs.length !== signIds.length) throw new BadRequestException('序列、部位或征象不属于当前病例系统或已失效');
    const [report] = await manager.query('SELECT sentences FROM reports WHERE case_id=$1 AND deleted_at IS NULL FOR SHARE', [context.item.id]) as { sentences:{ idx:number }[] }[];
    const sentenceIds = new Set((report?.sentences ?? []).map(s => s.idx));
    const dimensions = new Map<string, Awaited<ReturnType<OrthancService['frameGeometry']>>>();
    for (const item of annotations) {
      const source = series.find(s => s.id === item.series_id)!;
      if (item.frame_end >= source.frame_count) throw new BadRequestException('标注帧超出序列范围');
      if (source.modality === 'CT' && !item.window_preset) throw new BadRequestException('CT 标注必须记录窗预设');
      const frames = [item.key_frame_index, ...((item.geometry.frames ?? []) as {frame_index:number}[]).map(f=>f.frame_index)];
      for (const frame of frames) {
        const cacheKey = `${source.id}:${frame}`;
        let size = dimensions.get(cacheKey);
        if (!size) {
          const resolved = await this.orthanc.resolveSeriesFrame(source.orthanc_id,source.series_uid,frame,source.frame_count);
          size = await this.orthanc.frameGeometry(resolved.instance_id,resolved.frame_index);dimensions.set(cacheKey,size);
        }
        const g = item.geometry;
        const inside=(x:unknown,y:unknown)=>typeof x==='number'&&typeof y==='number'&&x>=0&&y>=0&&x<size!.width&&y<size!.height;
        if (item.tool==='brush' ? g.width!==size.width||g.height!==size.height :
            item.tool==='polygon' ? (g.points as number[][]).some(p=>!inside(p[0],p[1])) :
            !inside(g.x,g.y)||(item.tool==='box'&&((g.x as number)+(g.w as number)>size.width||(g.y as number)+(g.h as number)>size.height))) {
          throw new BadRequestException('标注几何超出 DICOM 尺寸或掩膜尺寸不一致');
        }
      }
      if (item.report_sent_ids.some(v => v !== REPORT_NOT_MENTIONED && !sentenceIds.has(v))) throw new BadRequestException('关联报告句号不存在');
    }
  }

  private async objects(manager: EntityManager, id: string, version: number) {
    return readAnnotationObjects(manager,id,version);
  }

  private async audit(manager: EntityManager, actor: string, action: string, caseId: string, detail: Record<string,unknown>, ip: string) {
    await manager.query('INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,$2,$3,$4::jsonb,$5)', [actor,action,`cases:${caseId}`,JSON.stringify(detail),ip]);
  }
}
