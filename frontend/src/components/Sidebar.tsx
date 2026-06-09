import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { RegenerateDialog } from './RegenerateDialog';
import { useQuizzes } from '../context';
import { req } from '../api';
import { getSidebarCollapsedState, setSidebarCollapsedState } from '../helpers';
import type { GroupQuizGenerationResult, Quiz, QuizGroup } from '../types';

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function QuizItem({ quiz, activeQuizId, onTogglePin, onDelete, groups, onMoveToGroup, onRemoveFromGroup, onGroupCreated, onRegenerate }: {
  quiz: Quiz;
  activeQuizId: string | null;
  onTogglePin: (quiz: Quiz) => void;
  onDelete: (quiz: Quiz) => void;
  groups: QuizGroup[];
  onMoveToGroup: (quiz: Quiz, groupId: string) => void;
  onRemoveFromGroup: (quiz: Quiz) => void;
  onGroupCreated: () => void;
  onRegenerate: (quiz: Quiz) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        onClick={() => navigate(`/quiz/${quiz.id}`)}
        className={`w-full flex items-center justify-between px-4 py-2 rounded text-left transition-colors duration-200 group ${activeQuizId === quiz.id ? 'bg-surface-container-highest text-on-surface' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {quiz.pinned ? (
            <Icon name="push_pin" size={16} className="text-secondary shrink-0" />
          ) : (
            <Icon name="history" size={16} className="shrink-0" />
          )}
          <span className="text-[12px] truncate">{quiz.title}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            ref={triggerRef}
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="text-text-muted hover:text-on-surface p-0.5"
          >
            <Icon name="more_vert" size={14} />
          </button>
        </div>
      </button>

      {showMenu && (
        <div ref={menuRef} className="absolute right-0 top-full z-50 mt-1 w-48 bg-surface-container border border-border-subtle rounded-lg shadow-xl py-1">
          {groups.some((g) => g.id !== quiz.groupId) && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">Move to group</div>
              {groups.filter((g) => g.id !== quiz.groupId).map((g) => (
                <button
                  key={g.id}
                  onClick={() => { onMoveToGroup(quiz, g.id); setShowMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted hover:text-on-surface hover:bg-surface-variant transition-colors"
                >
                  {g.name}
                </button>
              ))}
              <div className="border-t border-border-subtle my-1" />
            </>
          )}
          <button
            onClick={() => {
              const name = prompt('New group name:');
              if (name?.trim()) {
                req<QuizGroup>('/api/groups', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: name.trim() }),
                }).then(async (g) => {
                  onGroupCreated();
                  await onMoveToGroup(quiz, g.id);
                });
              }
              setShowMenu(false);
            }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted hover:text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-2"
          >
            <Icon name="create_new_folder" size={14} />
            Create new group
          </button>
          <div className="border-t border-border-subtle my-1" />
          {quiz.groupId ? (
            <button
              onClick={() => { onRemoveFromGroup(quiz); setShowMenu(false); }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted hover:text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-2"
            >
              <Icon name="folder_off" size={14} />
              Remove from group
            </button>
          ) : (
            <button
              onClick={() => { onTogglePin(quiz); setShowMenu(false); }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted hover:text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-2"
            >
              <Icon name="push_pin" size={14} fill={quiz.pinned} />
              {quiz.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          <button
            onClick={() => { onRegenerate(quiz); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted hover:text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-2"
          >
            <Icon name="autorenew" size={14} />
            Regenerate
          </button>
          <button
            onClick={() => { onDelete(quiz); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-error hover:bg-surface-variant transition-colors flex items-center gap-2"
          >
            <Icon name="delete" size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function GroupHeader({ group, onRename, onDelete, onRegenerate }: {
  group: QuizGroup;
  onRename: (group: QuizGroup) => void;
  onDelete: (group: QuizGroup) => void;
  onRegenerate: (group: QuizGroup) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  return (
    <div
      className="relative shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowMenu(!showMenu);
        }}
        className="text-text-muted hover:text-on-surface p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Icon name="more_vert" size={14} />
      </button>
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-1 w-36 bg-surface-container border border-border-subtle rounded-lg shadow-xl py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onRename(group); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted hover:text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-2"
          >
            <Icon name="edit" size={14} />
            Rename
          </button>
          <button
            onClick={() => { onRegenerate(group); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted hover:text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-2"
          >
            <Icon name="autorenew" size={14} />
            Regenerate group
          </button>
          <button
            onClick={() => { onDelete(group); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-[12px] text-error hover:bg-surface-variant transition-colors flex items-center gap-2"
          >
            <Icon name="delete" size={14} />
            Delete group
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { quizzes, groups, reload, reloadGroups } = useQuizzes();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(getSidebarCollapsedState);
  const [regenerateTarget, setRegenerateTarget] = useState<{ quiz?: Quiz; group?: QuizGroup; quizzes?: Quiz[] } | null>(null);

  const pinnedQuizzes = useMemo(() => quizzes.filter((q) => q.pinned && !q.groupId), [quizzes]);
  const recentQuizzes = useMemo(
    () => [...quizzes].filter((q) => !q.pinned && !q.groupId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
    [quizzes]
  );
  const groupedQuizzes = useMemo(() => {
    const map = new Map<string, Quiz[]>();
    for (const q of quizzes) {
      if (q.groupId) {
        const arr = map.get(q.groupId) ?? [];
        arr.push(q);
        map.set(q.groupId, arr);
      }
    }
    return map;
  }, [quizzes]);

  const isResults = location.pathname === '/results';
  const isShares = location.pathname === '/shares';
  const activeQuizId = location.pathname.startsWith('/quiz/') ? location.pathname.split('/')[2] : null;

  async function togglePin(quiz: Quiz) {
    await req<Quiz>(`/api/quizzes/${quiz.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !quiz.pinned }),
    });
    await reload();
  }

  async function deleteQuiz(quiz: Quiz) {
    if (!confirm(`Delete "${quiz.title}"?`)) return;
    await req<void>(`/api/quizzes/${quiz.id}`, { method: 'DELETE' });
    if (activeQuizId === quiz.id) navigate('/');
    await reload();
  }

  async function moveToGroup(quiz: Quiz, groupId: string) {
    await req<Quiz>(`/api/quizzes/${quiz.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    });
    await reload();
  }

  async function removeFromGroup(quiz: Quiz) {
    await req<Quiz>(`/api/quizzes/${quiz.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: null }),
    });
    await reload();
  }

  async function renameGroup(group: QuizGroup) {
    const name = prompt('Rename group:', group.name);
    if (name?.trim() && name.trim() !== group.name) {
      await req(`/api/groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      await reloadGroups();
    }
  }

  async function deleteGroup(group: QuizGroup) {
    const quizCount = groupedQuizzes.get(group.id)?.length ?? 0;
    if (!confirm(`Delete group "${group.name}"? This will remove ${quizCount} quiz${quizCount === 1 ? '' : 'zes'}.`)) return;
    await req<void>(`/api/groups/${group.id}`, { method: 'DELETE' });
    await reloadGroups();
    await reload();
  }

  async function createGroup() {
    const name = prompt('New group name:');
    if (name?.trim()) {
      await req<QuizGroup>('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      await reloadGroups();
    }
  }

  function toggleCollapse(groupId: string) {
    const next = { ...collapsed, [groupId]: !collapsed[groupId] };
    setCollapsed(next);
    setSidebarCollapsedState(next);
  }

  useEffect(() => {
    function syncCollapsedState(event: Event) {
      const customEvent = event as CustomEvent<Record<string, boolean>>;
      setCollapsed(customEvent.detail ?? getSidebarCollapsedState());
    }

    window.addEventListener('sidebar-collapsed-change', syncCollapsedState);
    return () => window.removeEventListener('sidebar-collapsed-change', syncCollapsedState);
  }, []);

  return (
    <>
      {regenerateTarget && (
        <RegenerateDialog
          quiz={regenerateTarget.quiz}
          group={regenerateTarget.group}
          quizzes={regenerateTarget.quizzes}
          onClose={() => setRegenerateTarget(null)}
          onComplete={(result) => {
            setRegenerateTarget(null);
            void reload();
            void reloadGroups();
            if (result && 'quizzes' in result && Array.isArray(result.quizzes)) {
              const groupResult = result as GroupQuizGenerationResult;
              setSidebarCollapsedState({
                ...getSidebarCollapsedState(),
                __groups__: false,
                [groupResult.groupId]: false
              });
              if (groupResult.quizzes[0]) {
                navigate(`/quiz/${groupResult.quizzes[0].id}`);
              }
              return;
            }
            if (result && 'id' in result) {
              navigate(`/quiz/${result.id}`);
            }
          }}
        />
      )}
      <nav
        className={`w-[280px] h-screen fixed left-0 top-0 border-r border-border-subtle bg-surface-sidebar flex flex-col z-50 transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
      <div className="flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-6 flex items-center gap-3 border-b border-border-subtle/50">
          <button onClick={() => navigate('/')} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded bg-primary-container flex items-center justify-center">
              <Icon name="lightbulb" fill size={18} className="text-secondary" />
            </div>
            <h1 className="text-[18px] font-bold text-on-surface font-geist tracking-tight">QuizGPT</h1>
          </button>
        </div>

        {/* New */}
        <div className="px-4 py-4">
          <div className="overflow-hidden rounded-lg border border-secondary/35 bg-accent-teal text-white shadow-sm">
            <div className="grid grid-cols-2">
              <button
                onClick={() => { navigate('/'); onClose(); }}
                className="flex items-center justify-center gap-2 px-3 py-3 text-[12px] font-bold transition-colors hover:bg-black/10"
              >
                <Icon name="bolt" size={18} />
                New Quiz
              </button>
              <button
                onClick={() => { navigate('/group-quiz/new'); onClose(); }}
                className="flex items-center justify-center gap-2 border-l border-white/20 bg-black/10 px-3 py-3 text-[12px] font-bold transition-colors hover:bg-black/18"
              >
                <Icon name="library_books" size={18} />
                New Group
              </button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="px-4 pb-2">
          <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] mb-1 px-1">Navigation</h3>
          <ul className="flex flex-col gap-0.5">
            <li>
              <button
                onClick={() => { navigate('/results'); onClose(); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors duration-200 ${isResults ? 'bg-surface-container-highest text-on-surface border-l-2 border-secondary' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
              >
                <Icon name="bar_chart" size={18} className={isResults ? 'text-secondary' : ''} />
                <span className="text-[12px] font-medium">Results & Metrics</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => { navigate('/shares'); onClose(); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors duration-200 ${isShares ? 'bg-surface-container-highest text-on-surface border-l-2 border-secondary' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
              >
                <Icon name="link" size={18} className={isShares ? 'text-secondary' : ''} />
                <span className="text-[12px] font-medium">Shares</span>
              </button>
            </li>
          </ul>
        </div>

        {/* Groups */}
        {groups.length > 0 && (
          <div className="mt-3 px-4">
            <div className="flex items-center justify-between mb-2 px-1">
              <button
                onClick={() => toggleCollapse('__groups__')}
                className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] hover:text-on-surface transition-colors"
              >
                Groups {collapsed['__groups__'] ? `(${groups.length})` : ''}
              </button>
              <button
                onClick={() => void createGroup()}
                className="text-text-muted hover:text-secondary p-0.5"
                title="New group"
              >
                <Icon name="add" size={14} />
              </button>
            </div>
            {!collapsed['__groups__'] && (
              <div className="flex flex-col gap-2">
                {groups.map((group) => {
                  const groupQuizzes = groupedQuizzes.get(group.id) ?? [];
                  const isCollapsed = collapsed[group.id] ?? false;
                  return (
                    <div key={group.id} className="group">
                      <button
                        onClick={() => toggleCollapse(group.id)}
                        className="w-full flex items-center gap-2 px-1 py-1 text-left hover:bg-surface-variant rounded transition-colors"
                      >
                        <Icon name={isCollapsed ? 'chevron_right' : 'expand_more'} size={16} className="text-text-muted shrink-0" />
                        <span className="text-[12px] font-medium text-on-surface truncate flex-1">{group.name}</span>
                        <span className="text-[10px] text-text-muted shrink-0">{groupQuizzes.length}</span>
                        <GroupHeader group={group} onRename={renameGroup} onDelete={deleteGroup} onRegenerate={(g) => setRegenerateTarget({ group: g, quizzes: groupedQuizzes.get(g.id) ?? [] })} />
                      </button>
                      {!isCollapsed && groupQuizzes.length > 0 && (
                        <ul className="flex flex-col gap-1 ml-4 mt-1">
                          {groupQuizzes.map((quiz) => (
                            <li key={quiz.id}>
                              <QuizItem
                                quiz={quiz}
                                activeQuizId={activeQuizId}
                                onTogglePin={togglePin}
                                onDelete={deleteQuiz}
                                groups={groups}
                                onMoveToGroup={moveToGroup}
                                onRemoveFromGroup={removeFromGroup}
                                onGroupCreated={reloadGroups}
                                onRegenerate={(q) => setRegenerateTarget({ quiz: q })}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Pinned */}
        {pinnedQuizzes.length > 0 && (
          <div className="mt-3 px-4">
            <button
              onClick={() => toggleCollapse('__pinned__')}
              className="w-full text-left px-1 py-1 mb-1"
            >
              <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] hover:text-on-surface transition-colors">
                Pinned {collapsed['__pinned__'] ? `(${pinnedQuizzes.length})` : ''}
              </h3>
            </button>
            {!collapsed['__pinned__'] && (
              <ul className="flex flex-col gap-1 ml-4">
                {pinnedQuizzes.map((quiz) => (
                  <li key={quiz.id}>
                    <QuizItem
                      quiz={quiz}
                      activeQuizId={activeQuizId}
                      onTogglePin={togglePin}
                      onDelete={deleteQuiz}
                      groups={groups}
                      onMoveToGroup={moveToGroup}
                      onRemoveFromGroup={removeFromGroup}
                      onGroupCreated={reloadGroups}
                      onRegenerate={(q) => setRegenerateTarget({ quiz: q })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Recent */}
        <div className="mt-3 px-4 flex-1">
          <button
            onClick={() => toggleCollapse('__recent__')}
            className="w-full text-left px-1 py-1 mb-1"
          >
            <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] hover:text-on-surface transition-colors">
              Recent {collapsed['__recent__'] ? `(${recentQuizzes.length})` : ''}
            </h3>
          </button>
          {!collapsed['__recent__'] && (
            <ul className="flex flex-col gap-1 ml-4">
              {recentQuizzes.map((quiz) => (
                <li key={quiz.id}>
                  <QuizItem
                    quiz={quiz}
                    activeQuizId={activeQuizId}
                    onTogglePin={togglePin}
                    onDelete={deleteQuiz}
                    groups={groups}
                    onMoveToGroup={moveToGroup}
                    onRemoveFromGroup={removeFromGroup}
                    onGroupCreated={reloadGroups}
                    onRegenerate={(q) => setRegenerateTarget({ quiz: q })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border-subtle px-2 py-4 space-y-1">
          <button
            onClick={() => { navigate('/settings'); onClose(); }}
            className={`w-full flex items-center gap-3 px-4 py-2 rounded transition-colors ${location.pathname === '/settings' ? 'bg-surface-container-highest text-on-surface border-l-2 border-secondary' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
          >
            <Icon name="settings" size={18} className={location.pathname === '/settings' ? 'text-secondary' : ''} />
            <span className="text-[12px]">Settings</span>
          </button>
        </div>
      </div>
    </nav>
    </>
  );
}
