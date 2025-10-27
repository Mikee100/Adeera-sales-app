import React, { ReactNode } from 'react';
interface AuthContextType {
    isAuthenticated: boolean;
    user: any | null;
    login: (credentials: {
        email: string;
        password: string;
    }) => Promise<void>;
    logout: () => void;
    loading: boolean;
}
interface AuthProviderProps {
    children: ReactNode;
}
export declare const AuthProvider: React.FC<AuthProviderProps>;
export declare const useAuth: () => AuthContextType;
export {};
//# sourceMappingURL=AuthContext.d.ts.map