import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AuthCallback from './pages/AuthCallback';
import AuthError from './pages/AuthError';
import Login from './pages/Login';
import { AuthProvider } from './contexts/AuthContext';
import { SpeedRunProvider } from './contexts/SpeedRunContext';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';
import ProtectedAdminRoute from './components/ProtectedAdminRoute';
import SpeedRunHost from './components/SpeedRunHost';

// Lazy load all page components for code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Prospects = lazy(() => import('./pages/Prospects'));
const ProspectDetail = lazy(() => import('./pages/ProspectDetail'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const VisiosPassees = lazy(() => import('./pages/VisiosPassees'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const Attributions = lazy(() => import('./pages/Attributions'));
const NotFound = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      staleTime: 2 * 60 * 1000, // 2 minutes - data stays fresh
      gcTime: 10 * 60 * 1000, // 10 minutes in cache
      refetchOnWindowFocus: false,
      refetchOnMount: false, // Don't refetch when navigating back
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <LoadingSpinner />
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <SpeedRunProvider>
        <BrowserRouter>
          {/* Monté au-dessus de <Routes> : la session Speed Run (file d'appels,
              index, stats) survit à tout changement de page. */}
          <SpeedRunHost />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/error" element={<AuthError />} />
            <Route
              path="/"
              element={
                <Layout>
                  <LazyPage>
                    <Dashboard />
                  </LazyPage>
                </Layout>
              }
            />
            <Route
              path="/prospects"
              element={
                <Layout>
                  <LazyPage>
                    <Prospects />
                  </LazyPage>
                </Layout>
              }
            />
            <Route
              path="/prospects/:id"
              element={
                <Layout>
                  <LazyPage>
                    <ProspectDetail />
                  </LazyPage>
                </Layout>
              }
            />
            <Route
              path="/pipeline"
              element={
                <Layout>
                  <LazyPage>
                    <Pipeline />
                  </LazyPage>
                </Layout>
              }
            />
            <Route
              path="/visios-passees"
              element={
                <Layout>
                  <LazyPage>
                    <VisiosPassees />
                  </LazyPage>
                </Layout>
              }
            />
            <Route
              path="/admin/users"
              element={
                <Layout>
                  <ProtectedAdminRoute>
                    <LazyPage>
                      <AdminUsers />
                    </LazyPage>
                  </ProtectedAdminRoute>
                </Layout>
              }
            />
            <Route
              path="/attributions"
              element={
                <Layout>
                  <LazyPage>
                    <Attributions />
                  </LazyPage>
                </Layout>
              }
            />
            <Route
              path="*"
              element={
                <LazyPage>
                  <NotFound />
                </LazyPage>
              }
            />
          </Routes>
        </BrowserRouter>
        </SpeedRunProvider>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;