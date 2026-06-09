import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AdminApp } from './context';
import { Layout } from './components/Layout';
import { CreateQuizPage } from './pages/CreateQuizPage';
import { QuizPage } from './pages/QuizPage';
import { ReviewPage } from './pages/ReviewPage';
import { ResultsPage } from './pages/ResultsPage';
import { SharesPage } from './pages/SharesPage';
import { SettingsPage } from './pages/SettingsPage';
import { GuestQuizPage } from './pages/GuestQuizPage';
import { GroupQuizWizardPage } from './pages/GroupQuizWizardPage';

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

  return (
    <AdminApp>
      <Layout>
        <Routes>
          <Route path="/" element={<CreateQuizPage />} />
          <Route path="/group-quiz/new" element={<GroupQuizWizardPage />} />
          <Route path="/quiz/:id" element={<QuizPage />} />
          <Route path="/review/:attemptId" element={<ReviewPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/shares" element={<SharesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AdminApp>
  );
}
