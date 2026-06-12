import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp, useQuizzes } from './context';
import { req } from './api';
import type { Quiz, QuizGroup } from './types';

vi.mock('./api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

const quizzes: Quiz[] = [{
  id: 'quiz-1',
  title: 'Quiz',
  topic: 'Topic',
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
  questions: []
}];

const groups: QuizGroup[] = [{
  id: 'group-1',
  name: 'Group',
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z'
}];

function Consumer() {
  const { quizzes, groups, reload, reloadGroups } = useQuizzes();
  return (
    <div>
      <span>quizzes:{quizzes.length}</span>
      <span>groups:{groups.length}</span>
      <button onClick={() => void reload()}>reload quizzes</button>
      <button onClick={() => void reloadGroups()}>reload groups</button>
    </div>
  );
}

describe('AdminApp', () => {
  beforeEach(() => {
    reqMock.mockReset();
  });

  it('loads quizzes and groups on mount and exposes reload functions', async () => {
    reqMock
      .mockResolvedValueOnce(quizzes)
      .mockResolvedValueOnce(groups)
      .mockResolvedValueOnce([{ ...quizzes[0], id: 'quiz-2' }])
      .mockResolvedValueOnce([{ ...groups[0], id: 'group-2' }]);

    render(
      <AdminApp>
        <Consumer />
      </AdminApp>
    );

    await waitFor(() => {
      expect(screen.getByText('quizzes:1')).toBeInTheDocument();
      expect(screen.getByText('groups:1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /reload quizzes/i }));
    fireEvent.click(screen.getByRole('button', { name: /reload groups/i }));

    await waitFor(() => {
      expect(screen.getByText('quizzes:1')).toBeInTheDocument();
      expect(screen.getByText('groups:1')).toBeInTheDocument();
      expect(reqMock).toHaveBeenCalledWith('/api/quizzes');
      expect(reqMock).toHaveBeenCalledWith('/api/groups');
    });
  });
});
