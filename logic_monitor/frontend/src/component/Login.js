import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import { AUTH_STORAGE_KEY } from '../constants/storage';
import '../assets/Login.css';

const getCookie = (name) => {
  if (!document?.cookie) return null;
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i += 1) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith(`${name}=`)) {
      return decodeURIComponent(cookie.substring(name.length + 1));
    }
  }
  return null;
};

function Login({
  apiBaseUrl,
  serviceApiBaseUrl = apiBaseUrl,
  auth,
  setAuth,
  homePath = '/alert-ingestion',
  productTitle = 'LogicMonitor Alert Console',
  metaBaseUrl,
}) {
  const navigate = useNavigate();
  const insightsRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const bootstrapAttemptedRef = useRef(false);

  useEffect(() => {
    if (auth?.access) {
      navigate(homePath, { replace: true });
    }
  }, [auth, navigate, homePath]);

  const performSessionLogin = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
      }
      try {
        const csrfToken = getCookie('csrftoken');
        const response = await fetch(`${serviceApiBaseUrl}/auth/session-login/`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
          },
          body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            data?.detail || `Unable to open ${productTitle}. Please authenticate via SSO first.`
          );
        }
        flushSync(() => {
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
          if (typeof setAuth === 'function') {
            setAuth(data);
          }
        });
        navigate(homePath, { replace: true });
        return true;
      } catch (error) {
        if (!silent) {
          console.error(`${productTitle} error:`, error);
          alert(error.message || `Failed to open ${productTitle}.`);
        }
        return false;
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [homePath, navigate, productTitle, serviceApiBaseUrl, setAuth]
  );

  useEffect(() => {
    if (auth?.access || bootstrapAttemptedRef.current) {
      return;
    }
    if (typeof sessionStorage !== 'undefined') {
      const skipSessionLogin = sessionStorage.getItem('scSkipSessionLogin');
      if (skipSessionLogin === '1') {
        sessionStorage.removeItem('scSkipSessionLogin');
        bootstrapAttemptedRef.current = true;
        return;
      }
    }
    bootstrapAttemptedRef.current = true;
    performSessionLogin({ silent: true });
  }, [auth, performSessionLogin]);

  const handleSSOLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/azure-login/`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.login_url) {
        window.location.href = data.login_url;
      } else if (data.success) {
        setLoading(false);
        navigate(homePath);
      } else {
        throw new Error('Unexpected response from the login service. Please retry.');
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoading(false);
      alert(error.message || 'Login failed.');
    }
  };

  const toggleInsights = () => setShowInsights((prev) => !prev);

  useEffect(() => {
    if (!showInsights) return undefined;
    const handleClickOutside = (event) => {
      if (
        insightsRef.current &&
        !insightsRef.current.contains(event.target) &&
        !event.target.closest('.insights-trigger')
      ) {
        setShowInsights(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showInsights]);

  return (
    <div className="login-container">
      {loading && (
        <div className="spinner-overlay">
          <div className="spinner" />
        </div>
      )}
      <div className="login-frame">
        <header className="login-header">
          <img src="logo_left.png" className="logo-left" alt="LogicMonitor logo" />
          <div className="login-title">{productTitle}</div>
          <img src="logo_right.png" className="logo-right" alt="Partner logo" />
          <button
            type="button"
            className={`insights-trigger ${showInsights ? 'active' : ''}`}
            aria-expanded={showInsights}
            aria-controls="login-insights"
            onClick={toggleInsights}
          >
            ?
          </button>
          {showInsights && (
            <div className="insights-popover" id="login-insights" role="dialog" ref={insightsRef}>
              <button
                type="button"
                className="close-insights"
                onClick={() => setShowInsights(false)}
                aria-label="Close operational insights"
              >
                ✖
              </button>
              <p className="insights-title">Operational insights</p>
              <ul>
                <li>Send consistent updates using curated templates.</li>
                <li>Audit timelines, incidents, and distribution lists in one workspace.</li>
                <li>Track the next communication commitment without spreadsheets.</li>
              </ul>
            </div>
          )}
        </header>
        <main className="login-box">
          <h1>Welcome back</h1>
          <p className="login-subtitle">Securely access alert ingestion, normalization, and delivery insights.</p>
          <button type="button" onClick={handleSSOLogin} disabled={loading}>
            {loading ? 'Signing you in…' : 'Login via SSO'}
          </button>
          <small className="login-hint">
            SSO is required. Reach out to the LogicMonitor admins if you need access.
          </small>
        </main>
      </div>
      <AppFooter apiBaseUrl={apiBaseUrl} metaBaseUrl={metaBaseUrl || apiBaseUrl} />
    </div>
  );
}

export default Login;
