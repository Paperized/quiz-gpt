import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareDialog } from './ShareDialog';
import { req } from '../api';
import type { QuizShare } from '../types';

vi.mock('../api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

const createdShare: QuizShare = {
  id: 'share-1',
  quizId: 'quiz-1',
  token: 'abc123',
  guestName: 'Jane Doe',
  maxAttempts: 3,
  expiresAt: '2026-06-12T12:00:00.000Z',
  createdAt: '2026-06-12T10:00:00.000Z',
  attemptCount: 0
};

describe('ShareDialog', () => {
  beforeEach(() => {
    reqMock.mockReset();
    Object.assign(window, {
      __APP_CONFIG__: { publicUrl: 'http://localhost:3000/' }
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  it('creates a share link with sanitized payload', async () => {
    reqMock.mockResolvedValueOnce(createdShare);

    render(<ShareDialog quizId="quiz-1" onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), {
      target: { value: ' Jane Doe ' }
    });
    fireEvent.change(screen.getByPlaceholderText('Unlimited'), {
      target: { value: '3' }
    });
    fireEvent.change(screen.getByDisplayValue(''), {
      target: { value: '2026-06-12T14:00' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledTimes(1);
    });

    const [, options] = reqMock.mock.calls[0];
    expect(reqMock.mock.calls[0][0]).toBe('/api/quizzes/quiz-1/shares');
    expect(options).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    expect(JSON.parse(options!.body as string)).toMatchObject({
      guestName: 'Jane Doe',
      maxAttempts: 3,
      expiresAt: new Date('2026-06-12T14:00').toISOString()
    });

    expect(await screen.findByText(/Share link created for/i)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost:3000\/public\/s\/abc123/i)).toBeInTheDocument();
  });

  it('copies the generated link to the clipboard', async () => {
    reqMock.mockResolvedValueOnce(createdShare);

    render(<ShareDialog quizId="quiz-1" onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. John Doe'), {
      target: { value: 'Jane Doe' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Generate Link/i }));

    await screen.findByRole('button', { name: /Copy Link/i });

    fireEvent.click(screen.getByRole('button', { name: /Copy Link/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/public/s/abc123');
    });

    expect(screen.getByRole('button', { name: /Copied!/i })).toBeInTheDocument();
  });
});
