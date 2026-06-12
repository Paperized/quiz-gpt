import { describe, expect, it } from 'vitest';
import {
  normalizeAttemptAnswers,
  scoreAttempt,
  scoreQuestion
} from './scoring.js';
import type { AttemptAnswer, QuizQuestion } from './types.js';

const questions: QuizQuestion[] = [
  {
    id: 'q-1',
    question: 'Capital of Italy?',
    responseType: 'single_choice',
    choices: ['Rome', 'Milan', 'Turin'],
    correctAnswers: [0]
  },
  {
    id: 'q-2',
    question: 'Select Linux package managers',
    responseType: 'multi_select',
    choices: ['apt', 'dnf', 'Photoshop', 'yum'],
    correctAnswers: [0, 1, 3]
  }
];

describe('normalizeAttemptAnswers', () => {
  it('reorders answers to match quiz question order', () => {
    const answers: AttemptAnswer[] = [
      { questionId: 'q-2', selectedAnswers: [1, 3] },
      { questionId: 'q-1', selectedAnswers: [0] }
    ];

    expect(normalizeAttemptAnswers(questions, answers)).toEqual([
      { questionId: 'q-1', selectedAnswers: [0] },
      { questionId: 'q-2', selectedAnswers: [1, 3] }
    ]);
  });

  it('rejects duplicate question identifiers', () => {
    const answers: AttemptAnswer[] = [
      { questionId: 'q-1', selectedAnswers: [0] },
      { questionId: 'q-1', selectedAnswers: [1] }
    ];

    expect(() => normalizeAttemptAnswers(questions, answers)).toThrow('duplicate questionId');
  });

  it('rejects invalid indices and multi-answer single choice submissions', () => {
    expect(() =>
      normalizeAttemptAnswers(questions, [
        { questionId: 'q-1', selectedAnswers: [0, 1] },
        { questionId: 'q-2', selectedAnswers: [0, 1] }
      ])
    ).toThrow('single choice questions allow at most one selected answer');

    expect(() =>
      normalizeAttemptAnswers(questions, [
        { questionId: 'q-1', selectedAnswers: [0] },
        { questionId: 'q-2', selectedAnswers: [5] }
      ])
    ).toThrow('invalid choice index');
  });
});

describe('scoreQuestion', () => {
  it('scores single choice questions as binary', () => {
    expect(scoreQuestion(questions[0], [0], 1)).toBe(1);
    expect(scoreQuestion(questions[0], [], 1)).toBe(0);
    expect(scoreQuestion(questions[0], [2], 1)).toBe(0);
  });

  it('applies partial credit and wrong-answer penalty for multi-select questions', () => {
    const question = questions[1];

    expect(scoreQuestion(question, [0, 1, 3], 1)).toBe(1);
    expect(scoreQuestion(question, [0, 1], 1)).toBeCloseTo(2 / 3, 5);
    expect(scoreQuestion(question, [0, 2], 0.5)).toBeCloseTo((1 / 3) - 0.5, 5);
  });
});

describe('scoreAttempt', () => {
  it('aggregates per-question scores into the final total', () => {
    const normalized = normalizeAttemptAnswers(questions, [
      { questionId: 'q-1', selectedAnswers: [0] },
      { questionId: 'q-2', selectedAnswers: [0, 1] }
    ]);

    expect(scoreAttempt(questions, normalized, 1)).toEqual({
      score: 1 + (2 / 3),
      questionScores: [1, 2 / 3]
    });
  });
});
