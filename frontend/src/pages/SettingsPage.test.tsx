import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { req } from '../api';
import type { SettingsDisplay } from '../types';

vi.mock('../api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

const settingsDisplay: SettingsDisplay = {
  LLM_API_STYLE: 'openai_compatible',
  LLM_BASE_URL: 'https://example.test/v1',
  LLM_API_KEY_MASKED: 'sk-****',
  LLM_MODEL: 'gpt-test',
  LLM_MAX_TOKENS: 1200,
  LLM_TEMPERATURE: 0.5,
  EMBEDDING_API_STYLE: 'same_as_llm',
  EMBEDDING_BASE_URL: '',
  EMBEDDING_API_KEY_MASKED: '',
  EMBEDDING_MODEL: '',
  MAX_EMBEDDING_CANDIDATES: 220,
  EMBEDDING_BATCH_SIZE: 64,
  MAX_RETRIEVED_CHUNKS: 16,
  MAX_RETRIEVED_CHARS: 28000,
  RATE_LIMIT_MAX_REQUESTS: 0,
  GENERATE_RATE_LIMIT_MAX_REQUESTS: 0,
  ENCRYPTION_CONFIGURED: true
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    reqMock.mockReset();
  });

  it('loads persisted settings into the form', async () => {
    reqMock.mockResolvedValueOnce(settingsDisplay);

    renderPage();

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://example.test/v1')).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue('gpt-test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1200')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('0')).toHaveLength(2);
  });

  it('validates user input before saving', async () => {
    reqMock.mockResolvedValueOnce(settingsDisplay);

    renderPage();

    await screen.findByDisplayValue('https://example.test/v1');

    fireEvent.change(screen.getByDisplayValue('https://example.test/v1'), {
      target: { value: 'not-a-url' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    expect(await screen.findByText('Must be a valid URL')).toBeInTheDocument();
    expect(reqMock).toHaveBeenCalledTimes(1);
  });

  it('submits sanitized settings values and shows success feedback', async () => {
    reqMock
      .mockResolvedValueOnce(settingsDisplay)
      .mockResolvedValueOnce(settingsDisplay);

    renderPage();

    await screen.findByDisplayValue('https://example.test/v1');

    fireEvent.change(screen.getByDisplayValue('https://example.test/v1'), {
      target: { value: 'https://llm.example/v1 ' }
    });
    fireEvent.change(screen.getByDisplayValue('gpt-test'), {
      target: { value: 'gpt-5-mini ' }
    });
    const spinButtons = screen.getAllByRole('spinbutton');

    fireEvent.change(spinButtons[5], {
      target: { value: '25' }
    });
    fireEvent.change(spinButtons[6], {
      target: { value: '10' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledTimes(2);
    });

    const call = reqMock.mock.calls[1];
    const payload = JSON.parse(call[1]!.body as string);

    expect(payload).toMatchObject({
      LLM_BASE_URL: 'https://llm.example/v1',
      LLM_MODEL: 'gpt-5-mini',
      RATE_LIMIT_MAX_REQUESTS: 25,
      GENERATE_RATE_LIMIT_MAX_REQUESTS: 10
    });
    expect(call[0]).toBe('/api/settings');
    expect(call[1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
