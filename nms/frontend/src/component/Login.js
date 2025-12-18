import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import '../assets/Login.css';

function Login({ apiBaseUrl, legacyBaseUrl }) {
  const navigate = useNavigate();
  const pollingRef = useRef(null);
  const insightsRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [showInsights, setShowInsights] = useState(false);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const startPollingLoginStatus = () => {
    let attempts = 0;
    const maxAttempts = 20;
    pollingRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch(`${apiBaseUrl}/azure-login/status/`, {
          credentials: 'include',
        });
        const data = await res.json();
        if (data.success) {
          clearInterval(pollingRef.current);
          setLoading(false);
          navigate('/diagnostics');
        } else if (attempts >= maxAttempts) {
          clearInterval(pollingRef.current);
          setLoading(false);
          alert('Login timed out. Please try again.');
        }
      } catch (err) {
        clearInterval(pollingRef.current);
        setLoading(false);
        alert('Error checking login status.');
      }
    }, 1000);
  };

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
        navigate('/diagnostics');
      } else {
        startPollingLoginStatus();
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoading(false);
      alert('Login failed.');
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
          <img src="logo_left.png" className="logo-left" alt="Network logo" />
          <div className="login-title">Network Management Operations</div>
          <img src="logo_right.png" className="logo-right" alt="Operations logo" />
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
          <p className="login-subtitle">Securely access diagnostics, ping tools, and incident workflows.</p>
          <button type="button" onClick={handleSSOLogin} disabled={loading}>
            {loading ? 'Signing you in…' : 'Login via SSO'}
          </button>
          <small className="login-hint">SSO is required. Reach out to the NMS team if you need access.</small>
        </main>
      </div>
      <AppFooter apiBaseUrl={apiBaseUrl} />
    </div>
  );
}

export default Login;
