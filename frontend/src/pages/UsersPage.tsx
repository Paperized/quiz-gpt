import { useCallback, useEffect, useState } from 'react';
import { req } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { AuthUser } from '../types.js';

export function UsersPage() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsers = useCallback(async () => {
    try {
      setError('');
      const data = await req<AuthUser[]>('/api/users');
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  async function toggleRole(user: AuthUser) {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await req(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      await fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Users</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[900px] mx-auto w-full flex flex-col gap-6">
          {error && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-surface-container rounded-xl border border-border-subtle overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="text-left px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">User</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Role</th>
                    <th className="text-left px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Provider</th>
                    <th className="text-right px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border-subtle last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="text-[13px] font-medium text-on-surface">{u.name || u.email}</div>
                        <div className="text-[11px] text-text-muted">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${u.role === 'admin' ? 'bg-secondary/10 text-secondary' : 'bg-surface-container-highest text-text-muted'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[12px] text-text-muted">{u.authProvider}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => toggleRole(u)}
                          className="text-[12px] font-medium text-primary hover:text-secondary transition-colors"
                        >
                          {u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
