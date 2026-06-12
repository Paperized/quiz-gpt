// ─── Helpers ─────────────────────────────────────────────────────────────────

import type { QuizSettings } from './types';

export const defaultSettings: QuizSettings = {
  numQuestions: 10,
  choicesPerQuestion: 4,
  difficulty: 5,
  language: 'English',
  questionType: 'mixed',
};

export function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function scoreColor(pct: number) {
  if (pct >= 80) return 'text-success';
  if (pct >= 60) return 'text-yellow-400';
  return 'text-error';
}

export function formatSeconds(s: number) {
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatScore(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}

export function getSidebarCollapsedState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('sidebar_collapsed') ?? '{}');
  } catch {
    return {};
  }
}

export function setSidebarCollapsedState(state: Record<string, boolean>) {
  localStorage.setItem('sidebar_collapsed', JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('sidebar-collapsed-change', { detail: state }));
}
