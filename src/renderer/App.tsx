import React from 'react';
import Login from './components/Login';
import POS from './components/POS';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastContainer, useToast } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import './error-boundary.css';

const AppContent: React.FC = () => {
  const { isAuthenticated, loading } = useAuth();
  const { toasts, removeToast } = useToast();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading SaaS POS...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        {isAuthenticated ? <POS /> : <Login />}
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </ErrorBoundary>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
