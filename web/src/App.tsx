import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { ToastContainer } from './components/Toast';
import { useEventStream } from './hooks/useEventStream';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Subscriptions = lazy(() => import('./pages/Subscriptions'));
const Rules = lazy(() => import('./pages/Rules'));
const Settings = lazy(() => import('./pages/Settings'));
const Logs = lazy(() => import('./pages/Logs'));
const Diagnostics = lazy(() => import('./pages/Diagnostics'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));

function AppInner() {
  useEventStream();

  return (
    <Layout>
      <Suspense>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:sourceIp" element={<ClientDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <AppInner />
    </BrowserRouter>
  );
}

export default App;
