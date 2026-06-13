import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.js';

export function ProtectedRoute({ children, adminOnly }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading, status } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    const redirect = status && !status.hasUsers ? '/register' : '/login';
    return <Navigate to={redirect} replace />;
  }

  if (adminOnly && user.role !== 'admin' && user.role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-error text-[14px]">Admin access required</p>
      </div>
    );
  }

  return <>{children}</>;
}
