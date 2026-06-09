import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { req } from '../api';
import { scoreColor, formatScore, formatSeconds } from '../helpers';
import type { AttemptHistory, Metrics } from '../types';

// ─── Results Page (/results) ──────────────────────────────────────────────────

export function ResultsPage() {
  const navigate = useNavigate();
  const [allHistory, setAllHistory] = useState<AttemptHistory[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [resultsTab, setResultsTab] = useState<'history' | 'metrics'>('history');
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [trendQuizId, setTrendQuizId] = useState('');
  const [userFilter, setUserFilter] = useState<string>('');

  async function load() {
    setResultsError(null);
    try {
      const [h, m] = await Promise.all([
        req<AttemptHistory[]>('/api/results/history'),
        req<Metrics>('/api/results/metrics'),
      ]);
      setAllHistory(h);
      setMetrics(m);
    } catch (e) {
      setResultsError(e instanceof Error ? e.message : 'Failed to load results');
    }
  }

  useEffect(() => { void load(); }, []);

  const users = useMemo(() => {
    const names = new Set<string>();
    for (const h of allHistory) {
      names.add(h.guestName ?? '__you__');
    }
    return Array.from(names).sort((a, b) => {
      if (a === '__you__') return -1;
      if (b === '__you__') return 1;
      return a.localeCompare(b);
    });
  }, [allHistory]);

  const history = useMemo(() => {
    let h = allHistory;
    if (userFilter === '__you__') h = h.filter((x) => x.guestName === null);
    else if (userFilter) h = h.filter((x) => x.guestName === userFilter);
    if (search) h = h.filter((x) => x.quizTitle.toLowerCase().includes(search.toLowerCase()));
    return h;
  }, [allHistory, userFilter, search]);

  const filteredMetrics = useMemo((): Metrics | null => {
    if (!metrics) return null;
    if (!userFilter) return metrics;

    const totalAttempts = history.length;
    const percentages = history.map((h) => h.total ? (h.score / h.total) * 100 : 0);
    const averageScore = percentages.length ? percentages.reduce((s, p) => s + p, 0) / percentages.length : 0;

    const bestByQuiz = new Map<string, number>();
    const countByQuiz = new Map<string, number>();
    const trendByQuiz = new Map<string, { quizTitle: string; points: Array<{ completedAt: string; scorePercent: number }> }>();

    for (const h of history) {
      const pct = h.total ? (h.score / h.total) * 100 : 0;
      bestByQuiz.set(h.quizId, Math.max(bestByQuiz.get(h.quizId) ?? Number.NEGATIVE_INFINITY, pct));
      countByQuiz.set(h.quizId, (countByQuiz.get(h.quizId) ?? 0) + 1);
      const trend = trendByQuiz.get(h.quizId) ?? { quizTitle: h.quizTitle, points: [] };
      trend.points.push({ completedAt: h.completedAt, scorePercent: pct });
      trendByQuiz.set(h.quizId, trend);
    }

    const bestScorePerQuiz = Array.from(bestByQuiz.entries()).map(([quizId, bestScore]) => ({
      quizId, quizTitle: history.find((h) => h.quizId === quizId)?.quizTitle ?? 'Unknown', bestScore
    }));
    const mostAttempted = Array.from(countByQuiz.entries()).sort((a, b) => b[1] - a[1])[0];

    return {
      totalQuizzes: metrics.totalQuizzes,
      totalAttempts,
      averageScore,
      bestScorePerQuiz,
      mostAttemptedQuiz: mostAttempted
        ? { quizId: mostAttempted[0], quizTitle: history.find((h) => h.quizId === mostAttempted[0])?.quizTitle ?? 'Unknown', attempts: mostAttempted[1] }
        : null,
      trendByQuiz: Object.fromEntries(trendByQuiz.entries()),
    };
  }, [metrics, history, userFilter]);

  useEffect(() => {
    if (!filteredMetrics) return;
    const ids = Object.keys(filteredMetrics.trendByQuiz);
    if (ids.length && !ids.includes(trendQuizId)) setTrendQuizId(ids[0]);
  }, [filteredMetrics]);

  const trendPoints = trendQuizId && filteredMetrics?.trendByQuiz[trendQuizId]?.points;

  function chartY(scorePercent: number) {
    const clamped = Math.max(-100, Math.min(100, scorePercent));
    return 100 - ((clamped + 100) / 2);
  }

  function userLabel(u: string) {
    return u === '__you__' ? 'You' : u;
  }

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Results & Metrics</h2>
        <div className="flex items-center gap-3">
          {users.length > 0 && (
            <div className="relative">
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="appearance-none bg-surface-container-low border border-border-subtle rounded px-3 py-1.5 pr-7 text-[12px] text-on-surface focus:outline-none focus:border-secondary transition-colors"
              >
                <option value="">All Users</option>
                {users.map((u) => (
                  <option key={u} value={u}>{userLabel(u)}</option>
                ))}
              </select>
              <Icon name="expand_more" size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            </div>
          )}
          <button onClick={() => void load()} className="flex items-center gap-2 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-secondary hover:border-secondary transition-colors bg-surface-container-low">
            <Icon name="refresh" size={16} /> Refresh
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          {resultsError && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{resultsError}</div>}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border-subtle">
            {(['history', 'metrics'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setResultsTab(tab)}
                className={`px-6 py-3 text-[12px] font-medium capitalize transition-colors ${resultsTab === tab ? 'text-primary font-bold border-b-2 border-secondary' : 'text-text-muted hover:text-secondary'}`}
              >{tab}</button>
            ))}
          </div>

          {/* History */}
          {resultsTab === 'history' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4 bg-surface-container-low p-4 rounded-lg border border-border-subtle">
                <div className="relative flex-1 max-w-sm">
                  <Icon name="search" size={18} className="text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className="w-full bg-surface-dim border border-border-subtle rounded pl-10 pr-4 py-2 text-[14px] text-on-surface focus:outline-none focus:border-accent-teal placeholder:text-text-muted"
                    placeholder="Search quizzes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button onClick={() => void load()} className="px-3 py-2 bg-surface border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface transition-colors">Apply</button>
              </div>

              <div className="border border-border-subtle rounded-lg bg-surface-container-low overflow-hidden">
                <div className="grid grid-cols-12 gap-4 p-4 border-b border-border-subtle bg-surface-variant/50 text-[12px] font-medium text-text-muted">
                  <div className="col-span-4">Quiz Name</div>
                  <div className="col-span-2 hidden sm:block">User</div>
                  <div className="col-span-2 hidden sm:block">Date</div>
                  <div className="col-span-2">Score</div>
                  <div className="col-span-2 text-right">Time</div>
                </div>
                {history.length === 0 ? (
                  <div className="p-8 text-center text-text-muted text-[14px]">No attempts yet. Generate and take a quiz first!</div>
                ) : history.map((h) => {
                  const pct = Math.round((h.score / h.total) * 100);
                  const widthPct = Math.max(0, Math.min(100, pct));
                  return (
                    <div key={h.id} onClick={() => navigate(`/review/${h.id}`)} className="grid grid-cols-12 gap-4 p-4 border-b border-border-subtle hover:bg-surface-variant/30 transition-colors items-center last:border-b-0 cursor-pointer group">
                      <div className="col-span-4 flex flex-col">
                        <span className="text-[14px] text-on-surface font-medium group-hover:text-accent-teal transition-colors flex items-center gap-2">
                          {h.quizTitle}
                          {h.quizDeleted && <span className="px-1.5 py-0.5 rounded bg-surface-bright text-text-muted text-[9px] uppercase tracking-wider font-medium">Deleted</span>}
                        </span>
                        <span className="text-[12px] text-text-muted">{formatScore(h.score)}/{h.total} score</span>
                      </div>
                      <div className="col-span-2 hidden sm:flex items-center gap-1.5">
                        {h.guestName ? (
                          <>
                            <Icon name="person" size={14} className="text-text-muted shrink-0" />
                            <span className="text-[13px] text-text-muted truncate">{h.guestName}</span>
                          </>
                        ) : (
                          <span className="text-[13px] text-secondary font-medium">You</span>
                        )}
                      </div>
                      <div className="col-span-2 hidden sm:block text-[14px] text-text-muted">{new Date(h.completedAt).toLocaleDateString()}</div>
                      <div className="col-span-2 flex items-center gap-2">
                        <span className={`text-[14px] font-medium ${scoreColor(pct)}`}>{pct}%</span>
                        <div className="w-12 h-1.5 bg-surface-bright rounded-full hidden lg:block overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 80 ? 'bg-success' : pct >= 60 ? 'bg-yellow-400' : 'bg-error'}`} style={{ width: `${widthPct}%` }} />
                        </div>
                      </div>
                      <div className="col-span-2 text-right flex items-center justify-end gap-1 text-[14px] text-text-muted">
                        <Icon name="schedule" size={16} />{formatSeconds(h.timeTakenSeconds)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metrics */}
          {resultsTab === 'metrics' && (
            <div className="flex flex-col gap-6">
              {!filteredMetrics ? (
                <div className="p-8 text-center text-text-muted text-[14px]">Loading metrics...</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: 'Total Quizzes', value: filteredMetrics.totalQuizzes, icon: 'library_books', sub: null },
                      { label: 'Total Attempts', value: filteredMetrics.totalAttempts, icon: 'repeat', sub: `Avg ${(filteredMetrics.totalAttempts / Math.max(filteredMetrics.totalQuizzes, 1)).toFixed(1)} per quiz` },
                      { label: 'Avg Score', value: `${filteredMetrics.averageScore.toFixed(1)}%`, icon: 'analytics', sub: null },
                      { label: 'Most Attempted', value: filteredMetrics.mostAttemptedQuiz?.quizTitle ?? '-', icon: 'local_fire_department', sub: filteredMetrics.mostAttemptedQuiz ? `${filteredMetrics.mostAttemptedQuiz.attempts} attempts` : null },
                    ].map((card) => (
                      <div key={card.label} className="border border-border-subtle rounded-lg bg-surface-container-low p-6 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-text-muted uppercase tracking-wider font-geist">{card.label}</span>
                          <Icon name={card.icon} size={20} className="text-primary" />
                        </div>
                        <div className="text-[32px] font-bold text-on-surface font-geist mt-2 leading-none">{card.value}</div>
                        {card.sub && <div className="text-[12px] text-text-muted mt-1">{card.sub}</div>}
                      </div>
                    ))}
                  </div>

                  {trendQuizId && trendPoints && trendPoints.length > 0 && (
                    <div className="border border-border-subtle rounded-lg bg-surface-container-low p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-[18px] font-medium text-on-surface font-geist">Performance Trend</h3>
                        <select className="bg-surface-dim border border-border-subtle rounded px-3 py-1.5 text-[12px] text-on-surface focus:outline-none" value={trendQuizId} onChange={(e) => setTrendQuizId(e.target.value)}>
                          {Object.entries(filteredMetrics.trendByQuiz).map(([id, t]) => <option key={id} value={id}>{t.quizTitle}</option>)}
                        </select>
                      </div>
                      <div className="relative w-full h-48 border-l border-b border-border-subtle">
                        <svg className="absolute left-0 top-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                          <defs>
                            <linearGradient id="chartGrad" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="#10A37F" stopOpacity="0.3" />
                              <stop offset="100%" stopColor="#10A37F" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <polygon fill="url(#chartGrad)" points={`0,100 ${trendPoints.map((p, i) => `${(i / Math.max(trendPoints.length - 1, 1)) * 100},${chartY(p.scorePercent)}`).join(' ')} ${100},100`} />
                          <polyline fill="none" stroke="#10A37F" strokeWidth="1.5" strokeLinejoin="round" points={trendPoints.map((p, i) => `${(i / Math.max(trendPoints.length - 1, 1)) * 100},${chartY(p.scorePercent)}`).join(' ')} />
                          {trendPoints.map((p, i) => <circle key={i} cx={(i / Math.max(trendPoints.length - 1, 1)) * 100} cy={chartY(p.scorePercent)} r="2" fill="#141313" stroke="#10A37F" strokeWidth="1.5" />)}
                        </svg>
                      </div>
                    </div>
                  )}

                  {filteredMetrics.bestScorePerQuiz.length > 0 && (
                    <div className="border border-border-subtle rounded-lg bg-surface-container-low overflow-hidden">
                      <div className="p-4 border-b border-border-subtle">
                        <h3 className="text-[14px] font-medium text-on-surface font-geist">Best Score per Quiz</h3>
                      </div>
                      {filteredMetrics.bestScorePerQuiz.map((b) => (
                        <div key={b.quizId} className="flex items-center justify-between p-4 border-b border-border-subtle last:border-b-0 hover:bg-surface-variant/20 transition-colors">
                          <span className="text-[14px] text-on-surface">{b.quizTitle}</span>
                          <div className="flex items-center gap-3">
                            <div className="w-24 h-1.5 bg-surface-bright rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${b.bestScore >= 80 ? 'bg-success' : b.bestScore >= 60 ? 'bg-yellow-400' : 'bg-error'}`} style={{ width: `${Math.max(0, Math.min(100, b.bestScore))}%` }} />
                            </div>
                            <span className={`text-[14px] font-bold ${scoreColor(b.bestScore)}`}>{b.bestScore.toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
