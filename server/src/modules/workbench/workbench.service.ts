import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/auth.models';
import { PermissionService } from '../auth/permission.service';
import { DATABASE_SOURCE } from '../database/database.tokens';
import { caseUuid } from '../cases/cases-clinical.service';
import { accountAvailable } from '../tasks/assignment-release';
@Injectable()
export class WorkbenchService {
  constructor(@Inject(DATABASE_SOURCE) private readonly db: DataSource) {}
  async read(actor: AuthUser, caseId: string, ip: string) {
    const id = caseUuid(caseId);
    return this.db.transaction(async manager => {
      const [current] = await manager.query('SELECT *,expire_at::text FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [actor.id]) as AuthUser[];
      if (!current || !accountAvailable(current) || current.updated_at.getTime() !== actor.updated_at.getTime()) throw new ForbiddenException('账号或会话已失效');
      const [item] = await manager.query(`SELECT id,case_no,source,system_code,status,clinical_text,age_band,sex,confirm_method FROM cases c
        WHERE id=$1 AND deleted_at IS NULL AND source='synthetic' AND EXISTS (
          SELECT 1 FROM audit_logs WHERE target='cases:'||c.id::text AND action IN ('case_import.deidentification_confirmed','case_manual.confirmed'))`, [id]);
      if (!item) throw new ForbiddenException('工作台病例不可访问');
      await new PermissionService(manager as unknown as DataSource).assertCaseAssignment(current, id, item.system_code, 'annotate');
      const series = await manager.query(`SELECT s.id,s.series_uid,s.modality,s.frame_count,s.default_window FROM series s
        JOIN studies st ON st.id=s.study_id WHERE st.case_id=$1 AND st.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY st.created_at,st.id,s.created_at,s.id`, [id]);
      const reports = await manager.query(`SELECT sentences FROM reports WHERE case_id=$1 AND deleted_at IS NULL`, [id]) as { sentences: { idx: number; text: string }[] }[];
      const sentences = (reports[0]?.sentences ?? []).map(({ idx, text }) => ({ idx, text })).sort((a,b) => a.idx-b.idx);
      const attachments = await manager.query('SELECT id,filename,kind FROM attachments WHERE case_id=$1 AND deleted_at IS NULL AND deid_confirmed=true ORDER BY created_at,id', [id]);
      await manager.query("INSERT INTO audit_logs(actor,action,target,detail,ip) VALUES($1,'workbench.viewed',$2,'{}',$3)", [current.id, `cases:${id}`, ip]);
      return { case: item, series, sentences, attachments };
    });
  }
}
