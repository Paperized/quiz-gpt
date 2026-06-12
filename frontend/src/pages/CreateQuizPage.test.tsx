import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateQuizPage } from './CreateQuizPage';
import { QuizzesContext } from '../context';
import { req } from '../api';

vi.mock('../api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

function renderPage() {
  return render(
    <QuizzesContext.Provider value={{
      quizzes: [],
      groups: [],
      reload: vi.fn(async () => {}),
      reloadGroups: vi.fn(async () => {})
    }}>
      <MemoryRouter>
        <CreateQuizPage />
      </MemoryRouter>
    </QuizzesContext.Provider>
  );
}

describe('CreateQuizPage difficulty control', () => {
  beforeEach(() => {
    reqMock.mockReset();
  });

  it('shows the numeric difficulty legend and submits difficulty as a number', async () => {
    reqMock.mockResolvedValueOnce({ jobId: 'job-1' });

    renderPage();

    expect(screen.getByText('5/10')).toBeInTheDocument();
    expect(screen.getByText('Intermediate')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Generate a quiz about/i), {
      target: { value: 'Build a Linux quiz' }
    });
    fireEvent.change(screen.getByLabelText('Difficulty'), {
      target: { value: '9' }
    });

    expect(screen.getByText('9/10')).toBeInTheDocument();
    expect(screen.getByText('Expert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Generate Quiz/i }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledTimes(1);
    });

    const formData = reqMock.mock.calls[0][1]?.body as FormData;
    const rawSettings = formData.get('settings');
    expect(typeof rawSettings).toBe('string');
    expect(JSON.parse(rawSettings as string)).toMatchObject({
      difficulty: 9
    });
  });
});
