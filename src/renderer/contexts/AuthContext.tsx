import React, { createContext, useContext, ReactNode } from 'react';

interface AuthContextType {
  isAuthenticated: boolean;
  user: any | null;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
  initialSyncComplete: boolean;
  onInitialSyncComplete: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  onInitialSyncComplete?: () => void;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children, onInitialSyncComplete }) => {
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [user, setUser] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [initialSyncComplete, setInitialSyncComplete] = React.useState(false);

  const handleInitialSyncComplete = React.useCallback(() => {
    setInitialSyncComplete(true);
    if (onInitialSyncComplete) {
      onInitialSyncComplete();
    }
  }, [onInitialSyncComplete]);

  React.useEffect(() => {
    // This will be called after initial sync completes
    // Check if user is already logged in (from local storage or previous session)
    const checkAuth = async () => {
      try {
        // Check for stored auth token
        const token = localStorage.getItem('authToken');
        if (token) {
          // Get user data from Electron main process
          const userData = await window.electronAPI.getUserData();
          if (userData) {
            console.log('🔐 Restored user session:', userData);
            setUser(userData);
            setIsAuthenticated(true);
          } else {
            // Clear invalid token and logout
            localStorage.removeItem('authToken');
            await window.electronAPI.logout();
            console.log('🔐 No valid user session found, logged out');
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        // Clear potentially corrupted data and logout
        localStorage.removeItem('authToken');
        await window.electronAPI.logout();
      } finally {
        setLoading(false);
      }
    };

    // Only check auth after initial sync is complete
    if (initialSyncComplete) {
      checkAuth();
    }
  }, [initialSyncComplete]);

  const login = async (credentials: { email: string; password: string }) => {
    try {
      setLoading(true);
      // Call Electron main process authenticate handler
      const response = await window.electronAPI.authenticate(credentials);
      if (response.success && response.token && response.user) {
        // Store token in localStorage for renderer context
        localStorage.setItem('authToken', response.token);
        setUser(response.user);
        setIsAuthenticated(true);
      } else {
        throw new Error(response.error || 'Login failed');
      }
    } catch (error) {
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      // Call Electron logout to clear stored data
      await window.electronAPI.logout();
      // Clear local state
      localStorage.removeItem('authToken');
      setUser(null);
      setIsAuthenticated(false);
      console.log('🔐 User logged out successfully');
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear local state even if Electron logout fails
      localStorage.removeItem('authToken');
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      isAuthenticated, 
      user, 
      login, 
      logout, 
      loading,
      initialSyncComplete,
      onInitialSyncComplete: handleInitialSyncComplete,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
