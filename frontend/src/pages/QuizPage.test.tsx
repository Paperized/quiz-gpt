import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QuizPage } from './QuizPage';
import { QuizzesContext } from '../context';
import { req } from '../api';
import type { Quiz } from '../types';

vi.mock('../api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

const quiz: Quiz = {
  id: 'quiz-1',
  title: 'General Knowledge',
  topic: 'Basics',
  createdAt: '2026-01-01T00:00:00.000Z',
  pinned: false,
  pinnedAt: null,
  groupId: null,
  settings: {
    numQuestions: 1,
    choicesPerQuestion: 4,
    difficulty: 5,
    language: 'English',
    questionType: 'multiple_choice'
  },
  questions: [
    {
      id: 'question-1',
      question: 'What is 2 + 2?',
      responseType: 'single_choice',
      choices: ['3', '4', '5', '6'],
      correctAnswers: [1],
      explanation: '2 + 2 equals 4.'
    }
  ]
};

function renderQuizPage() {
  return render(
    <QuizzesContext.Provider value={{
      quizzes: [quiz],
      groups: [],
      reload: vi.fn(async () => {}),
      reloadGroups: vi.fn(async () => {})
    }}>
      <MemoryRouter initialEntries={['/quiz/quiz-1']}>
        <Routes>
          <Route path="/quiz/:id" element={<QuizPage />} />
        </Routes>
      </MemoryRouter>
    </QuizzesContext.Provider>
  );
}

describe('QuizPage draft persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    reqMock.mockReset();
  });

  it('persists the current answers and restores them on revisit', () => {
    const key = 'quiz_draft:quiz-1';
    const { unmount } = renderQuizPage();

    expect(screen.getByText('Difficulty 5/10 · Intermediate')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('4'));

    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({
      answers: {
        'question-1': [1]
      },
      singleIndex: 0
    });

    unmount();
    renderQuizPage();

    expect(screen.getByLabelText('4')).toBeChecked();
  });

  it('clears the draft only after a successful submit', async () => {
    const key = 'quiz_draft:quiz-1';
    reqMock.mockResolvedValueOnce({ score: 1, total: 1 });

    renderQuizPage();

    fireEvent.click(screen.getAllByLabelText('4')[0]);
    expect(localStorage.getItem(key)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Submit Quiz' }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledWith('/api/attempts', expect.objectContaining({
        method: 'POST'
      }));
    });

    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByText('1/1 score')).toBeInTheDocument();
  });

  it('keeps the draft and shows an error when submit fails', async () => {
    const key = 'quiz_draft:quiz-1';
    reqMock.mockRejectedValueOnce(new Error('Network failure'));

    renderQuizPage();

    fireEvent.click(screen.getAllByLabelText('4')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quiz' }));

    expect(await screen.findByText('Network failure')).toBeInTheDocument();
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('resets answers on retake and shuffle', () => {
    const key = 'quiz_draft:quiz-1';
    vi.spyOn(Math, 'random').mockReturnValue(0);

    renderQuizPage();

    fireEvent.click(screen.getAllByLabelText('4')[0]);
    expect(screen.getAllByLabelText('4')[0]).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    expect(screen.getAllByLabelText('4')[0]).not.toBeChecked();

    fireEvent.click(screen.getAllByLabelText('4')[0]);
    fireEvent.click(screen.getByTitle('Shuffle'));

    expect(screen.getAllByLabelText('4')[0]).not.toBeChecked();
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({
      answers: {}
    });
  });
});
