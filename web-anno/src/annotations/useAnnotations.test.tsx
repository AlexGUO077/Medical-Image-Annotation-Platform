import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from '../auth/types';
import { annotationsApi } from './api';
import { useAnnotations } from './useAnnotations';

const session: Session = { token: 'header.' + btoa(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000001' })) + '.signature', role: 'member', quals: { cns: ['annotate'] } };
afterEach(() => vi.restoreAllMocks());

it('opens an assigned teaching case after server authorization and saves through the standard API', async () => {
  vi.spyOn(annotationsApi, 'read').mockResolvedValue({ version: 0, current_version: 0, annotations: [], latest_review: null });
  const save = vi.spyOn(annotationsApi, 'save').mockResolvedValue({ version: 1, annotations: [] });
  const { result, unmount } = renderHook(() => useAnnotations(session, 'case', 'teacher_provided_teaching'));
  await waitFor(() => expect(result.current.editable).toBe(true));
  await act(async () => {
    result.current.engine.current!.change([]);
    await result.current.engine.current!.saveNow();
  });
  expect(save).toHaveBeenCalledWith('case', session.token, expect.any(AbortSignal), 0, []);
  expect(result.current.state.status).toBe('saved');
  unmount();
});

it('keeps unapproved sources blocked before requesting annotations', () => {
  const read = vi.spyOn(annotationsApi, 'read');
  const { result, unmount } = renderHook(() => useAnnotations(session, 'case', 'unapproved'));
  expect(result.current.editable).toBe(false);
  expect(result.current.state.status).toBe('blocked');
  expect(read).not.toHaveBeenCalled();
  unmount();
});
