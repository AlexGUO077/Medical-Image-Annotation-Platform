export interface ReportSentence { idx: number; text: string }
export interface ReportCandidate {
  idx: number;
  score: number;
  matchedKeywords: string[];
  hasNonPositiveHint: boolean;
}

// These are ranking hints from the manual, never a clinical classification or submission exemption.
const nonPositivePrefix = /^\s*(?:未见|无|不除外|需与)/u;

/** Supply the selected signs' names/synonyms and the part name, not arbitrary report text. */
export function rankReportCandidates(sentences: readonly ReportSentence[], keywords: readonly string[]): ReportCandidate[] {
  const unique = [...new Set(keywords.map(word => word.trim().toLowerCase()).filter(Boolean))];
  return sentences.flatMap(sentence => {
    const clauses = sentence.text.toLowerCase().split(/[，,。；;\n]/u);
    const matchedKeywords: string[] = [];
    let score = 0, hasNonPositiveHint = false;
    for (const word of unique) {
      const hits = clauses.filter(clause => clause.includes(word));
      if (!hits.length) continue;
      matchedKeywords.push(word);
      const nonPositive = hits.some(clause => nonPositivePrefix.test(clause));
      hasNonPositiveHint ||= nonPositive;
      // Repeated words count once; a positive clause must not be hidden by a separate negative clause.
      score += hits.some(clause => !nonPositivePrefix.test(clause)) ? 1 : 0.5;
    }
    return score > 0 ? [{ idx: sentence.idx, score, matchedKeywords, hasNonPositiveHint }] : [];
  }).sort((a, b) => b.score - a.score || a.idx - b.idx);
}
