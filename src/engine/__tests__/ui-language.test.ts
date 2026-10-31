/**
 * "No clinical terms" is a requirement for the whole interface, not just the coach.
 * This test scans every UI source file for the guardrail lexicon. The only allowed hits are
 * code identifiers and explicit, reviewed disclaimers that *negate* or *describe* the rule.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findClinicalTerms } from '../coach/guardrails';

const ALLOWED = [
  /non-clinical/gi, // "non-clinical training companion"
  /'clinical'/g, // intent identifier in code
  /clinical_query/g, // event identifier
  /clinical \/ diagnostic term patterns/gi, // Methods page describing the guardrail
  /clinical language/gi, // describing what the safety layer blocks
  /clinical vocabulary/gi,
  /clinical lexicon/gi,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('UI copy', () => {
  it('contains no clinical or diagnostic vocabulary', () => {
    const files = [...walk('src/pages'), ...walk('src/components')].filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of files) {
      let text = readFileSync(f, 'utf8');
      for (const re of ALLOWED) text = text.replace(re, '');
      for (const term of findClinicalTerms(text)) hits.push(`${f}: ${term}`);
    }
    expect(hits).toEqual([]);
  });
});
