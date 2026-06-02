import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Icon } from './Icon';

// ─── Layout wrapper ───────────────────────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div style={{ backgroundColor: '#141313' }} className="text-on-surface antialiased flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && (
        <button className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />
      )}
      <div className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border-subtle sticky top-0 z-40" style={{ backgroundColor: '#141313' }}>
          <button onClick={() => navigate('/')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Icon name="lightbulb" fill size={18} className="text-secondary" />
            <span className="text-[18px] font-bold text-on-surface font-geist">QuizGPT</span>
          </button>
          <button onClick={() => setSidebarOpen(true)} className="text-on-surface">
            <Icon name="menu" size={24} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
