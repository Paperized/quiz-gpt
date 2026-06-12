import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { QuizSettings } from './types.js';

let extractJsonPayload: typeof import('./llm.js').extractJsonPayload;
let sanitizeQuestions: typeof import('./llm.js').sanitizeQuestions;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
  ({ extractJsonPayload, sanitizeQuestions } = await import('./llm.js'));
});

const multiSelectSettings: QuizSettings = {
  numQuestions: 1,
  choicesPerQuestion: 4,
  difficulty: 'Medium',
  language: 'English',
  questionType: 'multi_select'
};

describe('extractJsonPayload', () => {
  it('unwraps fenced json payloads and preserves plain json', () => {
    expect(extractJsonPayload('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonPayload('\n{"b":2}\n')).toBe('{"b":2}');
  });
});

describe('sanitizeQuestions', () => {
  it('remaps correct answers after shuffling choices', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const sanitized = sanitizeQuestions({
      title: 'Linux quiz',
      questions: [
        {
          question: 'Pick package managers',
          responseType: 'multi_select',
          choices: ['A', 'B', 'C', 'D'],
          correctAnswers: [1, 3],
          explanation: 'B and D are correct.'
        }
      ]
    }, multiSelectSettings);

    randomSpy.mockRestore();

    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].choices).toEqual(['B', 'C', 'D', 'A']);
    expect(sanitized[0].correctAnswers).toEqual([0, 2]);
    expect(sanitized[0].explanation).toBe('B and D are correct.');
  });

  it('rejects malformed correct answer metadata', () => {
    expect(() =>
      sanitizeQuestions({
        title: 'Broken quiz',
        questions: [
          {
            question: 'Invalid multi-select',
            responseType: 'multi_select',
            choices: ['A', 'B', 'C', 'D'],
            correctAnswers: [1, 1],
            explanation: 'Duplicate answers'
          }
        ]
      }, multiSelectSettings)
    ).toThrow('duplicate correctAnswers');

    expect(() =>
      sanitizeQuestions({
        title: 'Broken quiz',
        questions: [
          {
            question: 'Invalid multi-select',
            responseType: 'multi_select',
            choices: ['A', 'B', 'C', 'D'],
            correctAnswers: [1, 9],
            explanation: 'Out of range'
          }
        ]
      }, multiSelectSettings)
    ).toThrow('outside choices range');
  });
});
