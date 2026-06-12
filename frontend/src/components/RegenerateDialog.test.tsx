import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GenerationProgressDialog,
  RegenerateDialog,
  useGenerationJob
} from './RegenerateDialog';
import { req } from '../api';
import type { GenerationJob, Quiz } from '../types';

vi.mock('../api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

const quiz: Quiz = {
  id: 'quiz-1',
  title: 'Linux Basics',
  topic: 'Linux',
  createdAt: '2026-01-01T00:00:00.000Z',
  pinned: false,
  pinnedAt: null,
  groupId: null,
  settings: {
    numQuestions: 1,
    choicesPerQuestion: 4,
    difficulty: 'Medium',
    language: 'English',
    questionType: 'multiple_choice'
  },
  questions: [
    {
      id: 'question-1',
      question: 'What is ls?',
      responseType: 'single_choice',
      choices: ['command', 'animal', 'editor', 'protocol'],
      correctAnswers: [0]
    }
  ]
};

function createJob(
  overrides: Partial<GenerationJob<Quiz>> = {}
): GenerationJob<Quiz> {
  return {
    id: 'job-1',
    kind: 'quiz_regenerate',
    status: 'queued',
    currentStep: 'Validating request',
    stepIndex: 1,
    stepTotal: 6,
    doneCount: null,
    totalCount: null,
    message: null,
    resultPayload: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function PollHarness() {
  const { job, pollError } = useGenerationJob<Quiz>('job-1');
  return <GenerationProgressDialog job={job} pollError={pollError} open title="Generate quiz" />;
}

describe('generation job polling', () => {
  beforeEach(() => {
    reqMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls until completion and updates the visible step', async () => {
    reqMock
      .mockResolvedValueOnce(createJob())
      .mockResolvedValueOnce(createJob({
        status: 'running',
        currentStep: 'Calling model',
        stepIndex: 4
      }))
      .mockResolvedValueOnce(createJob({
        status: 'completed',
        currentStep: 'Saving result',
        stepIndex: 6,
        resultPayload: quiz
      }));

    render(<PollHarness />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Validating request')).toBeInTheDocument();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(reqMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Saving result')).toBeInTheDocument();
  });

  it('starts a regenerate job and completes exactly once', async () => {
    const onClose = vi.fn();
    const onComplete = vi.fn();

    reqMock
      .mockResolvedValueOnce({ jobId: 'job-1' })
      .mockResolvedValueOnce(createJob({
        status: 'running',
        currentStep: 'Preparing sources',
        stepIndex: 2
      }))
      .mockResolvedValueOnce(createJob({
        status: 'completed',
        currentStep: 'Saving result',
        stepIndex: 6,
        resultPayload: quiz
      }));

    render(
      <RegenerateDialog
        quiz={quiz}
        onClose={onClose}
        onComplete={onComplete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(reqMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Preparing sources')).toBeInTheDocument();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(quiz);
  });
});
