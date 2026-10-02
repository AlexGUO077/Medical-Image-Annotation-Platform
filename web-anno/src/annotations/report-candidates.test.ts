import { expect, it } from 'vitest';
import { rankReportCandidates } from './report-candidates';
it('matches sign names, synonyms and part names while preserving imported sentence IDs', () => {
  const sentences = [{ idx: 7, text: '右肺见结节影。' }, { idx: 2, text: '左肺见小结节。' }, { idx: 9, text: '心影无异常。' }];
  const result = rankReportCandidates(sentences, ['结节影', '小结节', '右肺']);
  expect(result).toEqual([
    { idx: 7, score: 2, matchedKeywords: ['结节影', '右肺'], hasNonPositiveHint: false },
    { idx: 2, score: 1, matchedKeywords: ['小结节'], hasNonPositiveHint: false },
  ]);
  expect(sentences.map(s => s.idx)).toEqual([7, 2, 9]);
});
it('downweights negative/differential hints without removing them from candidates', () => {
  const result = rankReportCandidates([{ idx: 0, text: '未见结节' }, { idx: 1, text: '不除外结节' }, { idx: 2, text: '结节' }], ['结节']);
  expect(result.map(c => [c.idx, c.score, c.hasNonPositiveHint])).toEqual([[2, 1, false], [0, 0.5, true], [1, 0.5, true]]);
});
it('does not hide a positive finding after an unrelated negative clause', () => {
  const [result] = rankReportCandidates([{ idx: 4, text: '未见胸水，右肺结节' }], ['结节', '胸水']);
  expect(result.score).toBe(1.5); expect(result.hasNonPositiveHint).toBe(true);
});
it('deduplicates repeated keywords, ignores blanks, and matches Latin text case-insensitively', () => {
  expect(rankReportCandidates([{ idx: 1, text: 'CT CT' }], ['CT', 'ct', ' ', ' CT '])).toEqual([{ idx: 1, score: 1, matchedKeywords: ['ct'], hasNonPositiveHint: false }]);
  expect(rankReportCandidates([{ idx: 1, text: '合成报告' }], [])).toEqual([]);
});
