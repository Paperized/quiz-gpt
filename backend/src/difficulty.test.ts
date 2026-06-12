import { describe, expect, it } from 'vitest';
import { buildDifficultyPromptGuidance, getDifficultyBand } from './difficulty.js';

describe('difficulty rubric', () => {
  it('maps numeric difficulty into stable bands', () => {
    expect(getDifficultyBand(2)).toMatchObject({ label: 'Introductory', rangeLabel: '1-2' });
    expect(getDifficultyBand(5)).toMatchObject({ label: 'Intermediate', rangeLabel: '5-6' });
    expect(getDifficultyBand(9)).toMatchObject({ label: 'Expert', rangeLabel: '9-10' });
  });

  it('rejects invalid difficulty values', () => {
    expect(() => getDifficultyBand(0)).toThrow();
    expect(() => getDifficultyBand(11)).toThrow();
    expect(() => getDifficultyBand(4.5)).toThrow();
  });

  it('produces explicit and distinct prompt guidance across levels', () => {
    const low = buildDifficultyPromptGuidance(2);
    const mid = buildDifficultyPromptGuidance(5);
    const high = buildDifficultyPromptGuidance(9);

    expect(low).toContain('Difficulty target: 2/10 (Introductory, range 1-2)');
    expect(low).toContain('Prefer direct recall or very simple recognition');
    expect(mid).toContain('Difficulty target: 5/10 (Intermediate, range 5-6)');
    expect(mid).toContain('Require moderate application, comparison, or diagnosis');
    expect(high).toContain('Difficulty target: 9/10 (Expert, range 9-10)');
    expect(high).toContain('very strong distractors');
  });
});
