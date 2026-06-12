import { z } from 'zod';

export const difficultySchema = z.number().int().min(1).max(10);

export type DifficultyBand = {
  label: 'Introductory' | 'Foundational' | 'Intermediate' | 'Advanced' | 'Expert';
  rangeLabel: string;
  summary: string;
  promptRequirements: {
    knowledgeDepth: string;
    reasoningComplexity: string;
    distractorPlausibility: string;
    scenarioLoad: string;
    priorKnowledge: string;
  };
};

const difficultyBands: Array<{ min: number; max: number; band: DifficultyBand }> = [
  {
    min: 1,
    max: 2,
    band: {
      label: 'Introductory',
      rangeLabel: '1-2',
      summary: 'Direct recall, obvious distractors, almost no assumed prior knowledge.',
      promptRequirements: {
        knowledgeDepth: 'Target basic concepts, definitions, or first-step facts.',
        reasoningComplexity: 'Prefer direct recall or very simple recognition over multi-step reasoning.',
        distractorPlausibility: 'Use clearly weaker distractors that do not compete closely with the right answer.',
        scenarioLoad: 'Avoid complex scenarios; keep questions short and straightforward.',
        priorKnowledge: 'Assume little or no prior domain experience.'
      }
    }
  },
  {
    min: 3,
    max: 4,
    band: {
      label: 'Foundational',
      rangeLabel: '3-4',
      summary: 'Basic operational knowledge with limited reasoning and modest distractor quality.',
      promptRequirements: {
        knowledgeDepth: 'Target foundational understanding and standard usage patterns.',
        reasoningComplexity: 'Allow light interpretation or comparison, but keep reasoning shallow.',
        distractorPlausibility: 'Use somewhat plausible distractors, but avoid subtle edge-case traps.',
        scenarioLoad: 'Use small practical contexts only when they improve clarity.',
        priorKnowledge: 'Assume early familiarity with the topic, but not expert practice.'
      }
    }
  },
  {
    min: 5,
    max: 6,
    band: {
      label: 'Intermediate',
      rangeLabel: '5-6',
      summary: 'Standard professional/intermediate level with moderate reasoning and credible distractors.',
      promptRequirements: {
        knowledgeDepth: 'Target standard working knowledge and non-trivial topic coverage.',
        reasoningComplexity: 'Require moderate application, comparison, or diagnosis where appropriate.',
        distractorPlausibility: 'Use credible distractors that reflect common misconceptions or close alternatives.',
        scenarioLoad: 'Use practical scenarios when helpful, but keep them concise and fair.',
        priorKnowledge: 'Assume the learner has meaningful prior exposure to the topic.'
      }
    }
  },
  {
    min: 7,
    max: 8,
    band: {
      label: 'Advanced',
      rangeLabel: '7-8',
      summary: 'Advanced application-heavy questions with strong distractors and deeper topic assumptions.',
      promptRequirements: {
        knowledgeDepth: 'Target deeper domain understanding, tradeoffs, and less obvious details.',
        reasoningComplexity: 'Require applied reasoning, scenario interpretation, or multi-factor comparison.',
        distractorPlausibility: 'Use strong distractors that are genuinely plausible to a partially skilled learner.',
        scenarioLoad: 'Lean on realistic scenarios, edge cases, and applied judgment when relevant.',
        priorKnowledge: 'Assume solid prior knowledge and practical familiarity with the topic.'
      }
    }
  },
  {
    min: 9,
    max: 10,
    band: {
      label: 'Expert',
      rangeLabel: '9-10',
      summary: 'Nuanced expert-level distinctions, strong distractors, and high reasoning demands.',
      promptRequirements: {
        knowledgeDepth: 'Target nuanced, specialized, or expert-level distinctions within the topic.',
        reasoningComplexity: 'Require advanced reasoning, diagnosis, or multi-step judgment where appropriate.',
        distractorPlausibility: 'Use very strong distractors that differ from the correct answer in subtle but fair ways.',
        scenarioLoad: 'Use realistic, non-trivial scenarios and expert-style decision points when relevant.',
        priorKnowledge: 'Assume strong prior knowledge and mature domain fluency.'
      }
    }
  }
];

export function getDifficultyBand(difficulty: number): DifficultyBand {
  const normalized = difficultySchema.parse(difficulty);
  const match = difficultyBands.find((entry) => normalized >= entry.min && normalized <= entry.max);
  if (!match) {
    throw new Error(`Unsupported difficulty value: ${difficulty}`);
  }
  return match.band;
}

export function buildDifficultyPromptGuidance(difficulty: number): string {
  const band = getDifficultyBand(difficulty);
  return [
    `Difficulty target: ${difficulty}/10 (${band.label}, range ${band.rangeLabel})`,
    `User-facing expectation: ${band.summary}`,
    'Difficulty requirements:',
    `- Knowledge depth: ${band.promptRequirements.knowledgeDepth}`,
    `- Reasoning complexity: ${band.promptRequirements.reasoningComplexity}`,
    `- Distractor plausibility: ${band.promptRequirements.distractorPlausibility}`,
    `- Scenario/application load: ${band.promptRequirements.scenarioLoad}`,
    `- Assumed prior knowledge: ${band.promptRequirements.priorKnowledge}`,
    '- Keep questions fair and answerable. Higher difficulty must come from depth and plausibility, not from trick wording or ambiguity.'
  ].join('\n');
}
