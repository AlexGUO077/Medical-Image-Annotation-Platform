import { expect, it } from 'vitest';
import { teachingDraftStore } from './teaching-drafts';

it('keeps teaching drafts isolated to one page store and clears them without browser persistence', async () => {
  const first = teachingDraftStore(), other = teachingDraftStore();
  await first.write({ baseVersion: 4, annotations: [] });
  expect(await first.read()).toEqual({ baseVersion: 4, annotations: [] });
  expect(await other.read()).toBeUndefined();
  const snapshot = (await first.read())!;
  snapshot.baseVersion = 99;
  expect((await first.read())!.baseVersion).toBe(4);
  await first.remove();
  expect(await first.read()).toBeUndefined();
});
