import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatScore,
  formatSeconds,
  getSidebarCollapsedState,
  scoreColor,
  setSidebarCollapsedState,
  shuffleArray
} from './helpers';

describe('frontend helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('formats time and scores consistently', () => {
    expect(formatSeconds(125)).toBe('2m 5s');
    expect(formatScore(2)).toBe('2');
    expect(formatScore(2.5)).toBe('2.5');
    expect(formatScore(2.345)).toBe('2.35');
  });

  it('maps score percentages to semantic colors', () => {
    expect(scoreColor(85)).toBe('text-success');
    expect(scoreColor(70)).toBe('text-yellow-400');
    expect(scoreColor(59)).toBe('text-error');
  });

  it('reads and writes sidebar collapsed state safely', () => {
    const listener = vi.fn();
    window.addEventListener('sidebar-collapsed-change', listener);

    setSidebarCollapsedState({ groupA: true });

    expect(getSidebarCollapsedState()).toEqual({ groupA: true });
    expect(listener).toHaveBeenCalledTimes(1);

    localStorage.setItem('sidebar_collapsed', '{broken');
    expect(getSidebarCollapsedState()).toEqual({});
  });

  it('shuffles without losing items', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(shuffleArray([1, 2, 3, 4])).toEqual([2, 3, 4, 1]);
  });
});
