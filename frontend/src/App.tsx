import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth.js';
import { AdminApp } from './context';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { CreateQuizPage } from './pages/CreateQuizPage';
import { QuizPage } from './pages/QuizPage';
import { ReviewPage } from './pages/ReviewPage';
import { ResultsPage } from './pages/ResultsPage';
import { SharesPage } from './pages/SharesPage';
import { GuestQuizPage } from './pages/GuestQuizPage';
import { GroupQuizWizardPage } from './pages/GroupQuizWizardPage';
import { AdminPage } from './pages/AdminPage';
import { ModelsPage } from './pages/ModelsPage';
import { ProfilePage } from './pages/ProfilePage';

// ─── Root ─────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  );
}

function AppRouter() {
  const location = useLocation();
  const isPublic = location.pathname.startsWith('/public/');

  if (isPublic) {
    return (
      <Routes>
        <Route path="/public/s/:token" element={<GuestQuizPage />} />
      </Routes>
    );
  }

  // Auth pages (no layout wrapper)
  if (location.pathname === '/login' || location.pathname === '/register') {
    return (
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <AdminApp>
        <Layout>
          <Routes>
            <Route path="/" element={<ProtectedRoute><CreateQuizPage /></ProtectedRoute>} />
            <Route path="/group-quiz/new" element={<ProtectedRoute><GroupQuizWizardPage /></ProtectedRoute>} />
            <Route path="/quiz/:id" element={<ProtectedRoute><QuizPage /></ProtectedRoute>} />
            <Route path="/review/:attemptId" element={<ProtectedRoute><ReviewPage /></ProtectedRoute>} />
            <Route path="/results" element={<ProtectedRoute><ResultsPage /></ProtectedRoute>} />
            <Route path="/shares" element={<ProtectedRoute><SharesPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/models" element={<ProtectedRoute><ModelsPage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </AdminApp>
    </AuthProvider>
  );
}
