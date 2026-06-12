export type DifficultyBand = {
  label: 'Introductory' | 'Foundational' | 'Intermediate' | 'Advanced' | 'Expert';
  rangeLabel: string;
  summary: string;
};

export const difficultyBands: Array<{ min: number; max: number; band: DifficultyBand }> = [
  {
    min: 1,
    max: 2,
    band: {
      label: 'Introductory',
      rangeLabel: '1-2',
      summary: 'Direct recall, obvious distractors, minimal assumed background.'
    }
  },
  {
    min: 3,
    max: 4,
    band: {
      label: 'Foundational',
      rangeLabel: '3-4',
      summary: 'Basic operational knowledge with light reasoning.'
    }
  },
  {
    min: 5,
    max: 6,
    band: {
      label: 'Intermediate',
      rangeLabel: '5-6',
      summary: 'Standard professional/intermediate level with credible distractors.'
    }
  },
  {
    min: 7,
    max: 8,
    band: {
      label: 'Advanced',
      rangeLabel: '7-8',
      summary: 'Applied reasoning, stronger distractors, deeper topic assumptions.'
    }
  },
  {
    min: 9,
    max: 10,
    band: {
      label: 'Expert',
      rangeLabel: '9-10',
      summary: 'Nuanced distinctions, expert judgment, and very strong distractors.'
    }
  }
];

export function getDifficultyBand(difficulty: number): DifficultyBand {
  const rounded = Math.round(difficulty);
  const match = difficultyBands.find((entry) => rounded >= entry.min && rounded <= entry.max);
  if (!match) {
    throw new Error(`Unsupported difficulty value: ${difficulty}`);
  }
  return match.band;
}

export function formatDifficultyLabel(difficulty: number): string {
  const band = getDifficultyBand(difficulty);
  return `Difficulty ${difficulty}/10 · ${band.label}`;
}
