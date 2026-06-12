import { describe, expect, it } from 'vitest';
import { formatDifficultyLabel, getDifficultyBand } from './difficulty';

describe('frontend difficulty helpers', () => {
  it('maps values to visible bands', () => {
    expect(getDifficultyBand(1)).toMatchObject({ label: 'Introductory', rangeLabel: '1-2' });
    expect(getDifficultyBand(4)).toMatchObject({ label: 'Foundational', rangeLabel: '3-4' });
    expect(getDifficultyBand(8)).toMatchObject({ label: 'Advanced', rangeLabel: '7-8' });
  });

  it('formats readable difficulty labels', () => {
    expect(formatDifficultyLabel(5)).toBe('Difficulty 5/10 · Intermediate');
    expect(formatDifficultyLabel(10)).toBe('Difficulty 10/10 · Expert');
  });
});
