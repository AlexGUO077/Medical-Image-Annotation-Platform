import type { EntityManager } from 'typeorm';
export async function readAnnotationObjects(manager: EntityManager, id: string, version: number) {
  const rows = await manager.query(`SELECT a.logical_id AS id,a.series_id,a.tool,a.geometry,a.frame_start,a.frame_end,
    a.key_frame_index,a.window_preset,a.part_id,a.confidence,a.report_sent_ids,a.version,a.is_gold,
    COALESCE((SELECT jsonb_agg(t.sign_tag_id ORDER BY t.sign_tag_id) FROM annotation_tags t
      WHERE t.annotation_id=a.id AND t.deleted_at IS NULL),'[]'::jsonb) AS sign_tag_ids
    FROM annotation_objects a WHERE a.case_id=$1 AND a.version=$2 AND a.deleted_at IS NULL ORDER BY a.logical_id`, [id,version]);
  return rows.map((row: { confidence: string | null }) => ({ ...row, confidence: row.confidence === null ? null : row.confidence === '典型' ? 'typical' : 'atypical' }));
}
export async function latestReview(manager: EntityManager, id: string) {
  const [review] = await manager.query(`SELECT id,reviewer_id,result,comments,created_at,is_spotcheck FROM reviews
    WHERE case_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1`, [id]);
  return review ?? null;
}
