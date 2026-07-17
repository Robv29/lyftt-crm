import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { client } from '../lib/api';
import { supabase } from '../lib/supabase';

interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  last_login?: string;
}

interface UserRole {
  id: number;
  user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  userRole: UserRole | null;
  loading: boolean;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
  isAdmin: boolean;
  accessDenied: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const checkAuthStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      setAccessDenied(false);

      let response;
      try {
        response = await client.auth.me();
      } catch {
        setUser(null);
        setUserRole(null);
        setLoading(false);
        return;
      }

      if (response?.data) {
        const userData = response.data as User;
        setUser(userData);

        // Fetch role from backend with retry
        let roleSuccess = false;
        for (let attempt = 0; attempt < 3 && !roleSuccess; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
            const roleRes = await client.apiCall.invoke({
              url: '/api/v1/user-management/me',
              method: 'GET',
              data: {},
            });
            if (roleRes?.data) {
              setUserRole(roleRes.data as UserRole);
              roleSuccess = true;
            }
          } catch (roleErr: any) {
            if (roleErr?.status === 403 || roleErr?.response?.status === 403) {
              setAccessDenied(true);
              roleSuccess = true; // Don't retry 403
            } else {
              console.error(`Failed to fetch role (attempt ${attempt + 1}):`, roleErr);
            }
          }
        }
      } else {
        setUser(null);
        setUserRole(null);
      }
    } catch {
      setUser(null);
      setUserRole(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    try {
      setError(null);
      await client.auth.toLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const logout = async () => {
    try {
      setError(null);
      await client.auth.logout();
      setUser(null);
      setUserRole(null);
      setAccessDenied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    }
  };

  useEffect(() => {
    checkAuthStatus();
    // Synchronise l'état applicatif avec les connexions/déconnexions Supabase.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        checkAuthStatus();
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AuthContextType = {
    user,
    userRole,
    loading,
    error,
    login,
    logout,
    refetch: checkAuthStatus,
    isAdmin: userRole?.role === 'admin',
    accessDenied,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};