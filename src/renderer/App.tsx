import React from 'react';
import Login from './components/Login';
import POS from './components/POS';
import { useAuth, AuthProvider } from './contexts/AuthContext';

const AppContent: React.FC = () => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading SaaS POS...</p>
      </div>
    );
  }

  return (
    <div className="app">
      {isAuthenticated ? <POS /> : <Login />}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
