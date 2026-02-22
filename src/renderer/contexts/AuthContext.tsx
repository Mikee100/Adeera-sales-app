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
    // Check if user is already logged in (from Electron secure storage)
    const checkAuth = async () => {
      try {
        // Get token from Electron main process (uses secure storage)
        // Note: We no longer store tokens in localStorage for security
        const token = await window.electronAPI.getAuthToken();
        if (token) {
          // Get user data from Electron main process
          const userData = await window.electronAPI.getUserData();
          if (userData) {
            console.log('🔐 Restored user session:', userData);
            setUser(userData);
            setIsAuthenticated(true);
            // Store a flag in localStorage (not the token) for quick auth check
            localStorage.setItem('isAuthenticated', 'true');
          } else {
            // Clear invalid token and logout
            localStorage.removeItem('isAuthenticated');
            await window.electronAPI.logout();
            console.log('🔐 No valid user session found, logged out');
          }
        } else {
          // No token found, clear auth flag
          localStorage.removeItem('isAuthenticated');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        // Clear potentially corrupted data and logout
        localStorage.removeItem('isAuthenticated');
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
      // Token is stored securely in Electron main process (encrypted)
      const response = await window.electronAPI.authenticate(credentials);
      if (response.success && response.token && response.user) {
        // SECURE: Token is stored in Electron secure storage, not localStorage
        // Only store a flag in localStorage for quick auth check
        localStorage.setItem('isAuthenticated', 'true');
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
      // Call Electron logout to clear stored data (including encrypted token)
      await window.electronAPI.logout();
      // Clear local state
      localStorage.removeItem('isAuthenticated');
      setUser(null);
      setIsAuthenticated(false);
      console.log('🔐 User logged out successfully');
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear local state even if Electron logout fails
      localStorage.removeItem('isAuthenticated');
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
