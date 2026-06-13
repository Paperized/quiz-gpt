import { useAuth } from '../auth.js';
import { Icon } from '../components/Icon.js';

export function ProfilePage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Profile</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[600px] mx-auto w-full flex flex-col gap-6">
          <div className="bg-surface-container rounded-xl border border-border-subtle p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center">
                <Icon name="person" size={28} className="text-secondary" />
              </div>
              <div>
                <h3 className="text-[16px] font-semibold text-on-surface">
                  {user.name || user.email}
                </h3>
                <p className="text-[12px] text-text-muted">{user.email}</p>
              </div>
            </div>

            <fieldset disabled className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-[0.1em] mb-1">Email</label>
                <input
                  type="text"
                  value={user.email}
                  readOnly
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface/50 text-[14px] text-text-muted cursor-not-allowed"
                />
              </div>
              {user.name && (
                <div>
                  <label className="block text-[11px] font-bold text-text-muted uppercase tracking-[0.1em] mb-1">Name</label>
                  <input
                    type="text"
                    value={user.name}
                    readOnly
                    className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface/50 text-[14px] text-text-muted cursor-not-allowed"
                  />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-[0.1em] mb-1">Role</label>
                <input
                  type="text"
                  value={user.role}
                  readOnly
                  className={`w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface/50 text-[14px] cursor-not-allowed font-medium ${user.role === 'super_admin' ? 'text-amber-400' : user.role === 'admin' ? 'text-secondary' : 'text-text-muted'}`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-[0.1em] mb-1">Auth Provider</label>
                <input
                  type="text"
                  value={user.authProvider}
                  readOnly
                  className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface/50 text-[14px] text-text-muted cursor-not-allowed"
                />
              </div>
            </fieldset>
            <p className="text-[11px] text-text-muted mt-4 italic">
              Profile editing will be available in a future update.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
