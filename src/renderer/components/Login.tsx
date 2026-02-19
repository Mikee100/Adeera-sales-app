import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { handleError, AppError } from '../utils/error-handler';
import { showToast } from './Toast';

const Login: React.FC = () => {
  const { login, loading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  const [formError, setFormError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [capsLockOn, setCapsLockOn] = useState(false);

  const validateEmail = (value: string) => {
    if (!value.trim()) {
      return 'Email is required';
    }
    // Simple email pattern suitable for client-side validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(value)) {
      return 'Enter a valid business email';
    }
    return '';
  };

  const validatePassword = (value: string) => {
    if (!value.trim()) {
      return 'Password is required';
    }
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const emailValidationError = validateEmail(email);
    const passwordValidationError = validatePassword(password);

    setEmailError(emailValidationError);
    setPasswordError(passwordValidationError);

    if (emailValidationError || passwordValidationError) {
      return;
    }

    try {
      await login({ email, password });
      showToast('Welcome back 👋', 'success', 2000);

      if (rememberMe) {
        // Basic "remember me" UX – you can later hook this into a real refresh token flow
        localStorage.setItem('rememberedEmail', email);
      } else {
        localStorage.removeItem('rememberedEmail');
      }
    } catch (err: any) {
      // Extract error message - handle both Electron IPC errors and direct errors
      let errorMessage = 'We could not sign you in. Please check your details and try again.';
      
      if (err?.response?.data) {
        // Axios error response
        errorMessage = 
          err.response.data.message || 
          err.response.data.error ||
          (Array.isArray(err.response.data.message) ? err.response.data.message[0] : null) ||
          err.message ||
          errorMessage;
      } else if (err?.message) {
        // Direct error message (from Electron IPC or Error object)
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        // String error
        errorMessage = err;
      }

      setFormError(errorMessage);

      handleError(
        new AppError(errorMessage, 'UNAUTHORIZED', {
          operation: 'login',
          component: 'Login',
          metadata: { email },
        }),
        {
          operation: 'login',
          component: 'Login',
        }
      );
    }
  };

  useEffect(() => {
    const storedEmail = localStorage.getItem('rememberedEmail');
    if (storedEmail) {
      setEmail(storedEmail);
      setRememberMe(true);
    }
  }, []);

  const handlePasswordKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ('getModifierState' in event) {
      const caps = event.getModifierState('CapsLock');
      setCapsLockOn(caps);
    }
  };

  const isSubmitting = loading;

  return (
    <div className="login-container">
      <div className="login-shell">
        <div className="login-brand-panel">
          <div className="login-brand-logo">
            <span className="login-logo-mark">S</span>
            <span className="login-logo-text">SaaS POS</span>
          </div>
          <p className="login-brand-tagline">
            Modern point-of-sale for growing teams. Secure, fast, and built for multi-branch operations.
          </p>

          <div className="login-brand-highlights">
            <div className="login-highlight">
              <span className="login-highlight-dot" />
              <div>
                <div className="login-highlight-title">Role-based access</div>
                <div className="login-highlight-subtitle">Fine-grained control for admins and staff.</div>
              </div>
            </div>
            <div className="login-highlight">
              <span className="login-highlight-dot" />
              <div>
                <div className="login-highlight-title">Real-time insights</div>
                <div className="login-highlight-subtitle">Track sales and inventory live across locations.</div>
              </div>
            </div>
          </div>

          <div className="login-environment-pill">
            <span className="login-env-dot" />
            <span>Secure access</span>
          </div>
        </div>

        <div className="login-card">
          <div className="login-header">
            <h1>Sign in to your account</h1>
            <p>Use your work email and password to access the POS console.</p>
          </div>

          {formError && (
            <div className="error-message" role="alert">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <div className={`form-group ${emailError ? 'has-error' : ''}`}>
              <label htmlFor="email">Work email</label>
              <div className="form-input-wrapper">
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) {
                      setEmailError(validateEmail(e.target.value));
                    }
                  }}
                  placeholder="you@company.com"
                  disabled={isSubmitting}
                  autoComplete="email"
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? 'email-error' : undefined}
                />
              </div>
              {emailError && (
                <div id="email-error" className="field-error">
                  {emailError}
                </div>
              )}
            </div>

            <div className={`form-group ${passwordError ? 'has-error' : ''}`}>
              <label htmlFor="password">Password</label>
              <div className="form-input-wrapper">
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (passwordError) {
                      setPasswordError(validatePassword(e.target.value));
                    }
                  }}
                  placeholder="Enter your password"
                  disabled={isSubmitting}
                  autoComplete="current-password"
                  aria-invalid={!!passwordError}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                  onKeyDown={handlePasswordKeyDown}
                />
              </div>
              {passwordError && (
                <div id="password-error" className="field-error">
                  {passwordError}
                </div>
              )}
              {capsLockOn && !passwordError && (
                <div className="field-hint warning">
                  Caps Lock is on – passwords are case sensitive.
                </div>
              )}
            </div>

            <div className="login-form-meta">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={isSubmitting}
                />
                <span>Remember this device</span>
              </label>

              <button
                type="button"
                className="link-button"
                onClick={() =>
                  showToast('Password reset is managed by your administrator.', 'info', 2500)
                }
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              className="login-button"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing you in…' : 'Sign in'}
            </button>
          </form>

          <div className="login-footer">
            <p>
              Having trouble? Contact your account administrator for access.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
