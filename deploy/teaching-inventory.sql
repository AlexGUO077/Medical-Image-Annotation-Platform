SELECT coalesce(jsonb_agg(record ORDER BY record->>'id'), '[]')
FROM (
    SELECT jsonb_build_object(
        'id', c.id,
        'case_digest', encode(sha256(convert_to(jsonb_build_array(c.case_no, c.system_code,
            c.confirm_method, c.disease_tag_id, c.clinical_text, c.teaching_fields)::text, 'UTF8')), 'hex'),
        'series', (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'frames', s.frame_count,
                    'modality', s.modality, 'uid', s.series_uid) ORDER BY s.id)
            FROM public.studies st JOIN public.series s ON s.study_id = st.id
            WHERE st.case_id = c.id AND st.deleted_at IS NULL AND s.deleted_at IS NULL),
        'report', (SELECT encode(sha256(convert_to(r.raw_text, 'UTF8')), 'hex')
            FROM public.reports r WHERE r.case_id = c.id AND r.deleted_at IS NULL AND trim(r.raw_text) <> ''),
        'assignments', (SELECT jsonb_agg(jsonb_build_array(a.id, a.assignee_id, t.id) ORDER BY a.id, t.id)
            FROM public.task_assignments a JOIN public.task_cases tc ON tc.case_id = a.case_id
            JOIN public.tasks t ON t.id = tc.task_id
            WHERE a.case_id = c.id AND a.task_role = 'annotate' AND a.deleted_at IS NULL
                AND tc.deleted_at IS NULL AND t.deleted_at IS NULL),
        'items', (SELECT jsonb_agg(jsonb_build_object('id', i.id, 'task', t.id,
                'digest', encode(sha256(convert_to(i.reference::text, 'UTF8')), 'hex'),
                'sections', coalesce(trim(i.reference->>'findings') <> '' AND trim(i.reference->>'impression') <> '', false),
                'students', (SELECT jsonb_agg(r.id ORDER BY r.id)
                    FROM public.education_students es JOIN public.education_roster r ON r.id = es.roster_id
                    WHERE es.task_id = t.id AND es.deleted_at IS NULL AND r.deleted_at IS NULL)) ORDER BY i.id)
            FROM public.education_items i JOIN public.education_tasks t ON t.id = i.task_id
            WHERE i.case_id = c.id AND i.deleted_at IS NULL AND t.deleted_at IS NULL AND t.status <> 'revoked'),
        'attempts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'item', a.item_id,
                'student', a.student_id, 'state', a.state, 'version', a.version, 'submitted', a.submitted_at,
                'answer', encode(sha256(convert_to(a.answer::text, 'UTF8')), 'hex')) ORDER BY a.id), '[]')
            FROM public.education_attempts a JOIN public.education_items i ON i.id = a.item_id
            WHERE i.case_id = c.id AND a.deleted_at IS NULL AND i.deleted_at IS NULL)
    ) AS record
    FROM public.cases c
    WHERE c.deleted_at IS NULL AND c.source = 'teacher_provided_teaching'
        AND c.id = ANY(ARRAY[/*CASE_UUIDS*/]::uuid[])
) entries;
