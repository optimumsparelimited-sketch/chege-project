import { Route, Switch, Router as WouterRouter } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@workspace/replit-auth-web';
import LoginPage from '@/pages/login';
import { Layout } from '@/components/layout';
import Dashboard from '@/pages/dashboard';
import Expenses from '@/pages/expenses';
import Budget from '@/pages/budget';
import Contributions from '@/pages/contributions';
import Activity from '@/pages/activity';
import NotFound from '@/pages/not-found';
import AuthDone from '@/pages/auth-done';
import Settings from '@/pages/settings';
import SavingsGoals from '@/pages/savings-goals';
import Bank from '@/pages/bank';
import Parity from '@/pages/parity';

const queryClient = new QueryClient();

function AuthenticatedApp() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/expenses" component={Expenses} />
        <Route path="/budget" component={Budget} />
        <Route path="/contributions" component={Contributions} />
        <Route path="/activity" component={Activity} />
        <Route path="/savings-goals" component={SavingsGoals} />
        <Route path="/bank" component={Bank} />
        <Route path="/settings" component={Settings} />
        <Route path="/parity" component={Parity} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function MainRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl"></div>
          <div className="h-4 w-24 bg-primary/20 rounded"></div>
        </div>
      </div>
    );
  }

  // Auth-done page must be reachable before auth state resolves (popup context).
  if (window.location.pathname.endsWith('/auth-done')) {
    return <AuthDone />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <MainRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
