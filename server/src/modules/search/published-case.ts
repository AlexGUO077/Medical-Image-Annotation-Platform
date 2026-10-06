// Reused by query, detail, indexing and frame authorization. Never trust ES state as authority.
export const publishedPredicate = `c.deleted_at IS NULL AND c.source='synthetic' AND c.status='已发布'
 AND EXISTS(SELECT 1 FROM audit_logs z WHERE z.target='cases:'||c.id::text
   AND z.action IN ('case_import.deidentification_confirmed','case_manual.confirmed'))
 AND (EXISTS(SELECT 1 FROM annotation_objects a WHERE a.case_id=c.id AND a.version=c.annotation_version
   AND a.deleted_at IS NULL AND a.is_gold) OR EXISTS(SELECT 1 FROM audit_logs p WHERE p.target='cases:'||c.id::text
   AND p.action='cases.published' AND p.detail->>'version'=c.annotation_version::text))
 AND NOT EXISTS(SELECT 1 FROM annotation_objects a WHERE a.case_id=c.id AND a.version=c.annotation_version
   AND a.deleted_at IS NULL AND NOT a.is_gold)`;
export const reportJoin = 'LEFT JOIN reports r ON r.case_id=c.id AND r.deleted_at IS NULL';
export const revisionKey = `c.id::text||':'||c.annotation_version::text||':'||c.updated_at::text||':'||COALESCE(r.updated_at::text,'')`;
export const systemNames:Record<string,string>={cns:'中枢神经系统',headneck:'头颈',resp:'呼吸',circ:'循环',digest:'消化',uro:'泌尿',repro:'生殖',bone:'骨骼'};
