import type { AnnotationDraft, DraftStore } from './drafts';
import { annotationPayload } from './types';

/** Teaching annotations stay in this page's memory; saved versions live on the authenticated server. */
export function teachingDraftStore(): DraftStore {
  let current: AnnotationDraft | undefined;
  return {
    read: async () => current ? structuredClone(current) : undefined,
    write: async draft => { current = { baseVersion: draft.baseVersion, annotations: annotationPayload(draft.annotations) }; },
    remove: async () => { current = undefined; },
  };
}
