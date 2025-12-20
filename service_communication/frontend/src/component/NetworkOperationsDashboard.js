import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import { AUTH_STORAGE_KEY } from '../constants/storage';
import '../assets/NetworkOperations.css';

const normalizeBase = (value) => {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

function NetworkOperationsDashboard({ apiBaseUrl, rootApiBaseUrl, auth, setAuth }) {
  const navigate = useNavigate();
  const apiBase = useMemo(() => normalizeBase(apiBaseUrl), [apiBaseUrl]);
  const [status, setStatus] = useState({ loading: true, error: '', data: null });
  const [activity, setActivity] = useState([]);

  const persistAuth = useCallback(
    (nextAuth) => {
      if (nextAuth) {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
      setAuth(nextAuth);
    },
    [setAuth]
  );

  const fetchStatus = useCallback(async () => {
    if (!auth?.access) {
      navigate('/');
      return;
    }
    setStatus({ loading: true, error: '', data: null });
    try {
      const response = await fetch(`${apiBase}/status/`, {
        headers: {
          Authorization: `Bearer ${auth.access}`,
        },
        credentials: 'include',
      });
      if (response.status === 401) {
        persistAuth(null);
        navigate('/');
        return;
      }
      if (!response.ok) {
        throw new Error('Unable to reach Network Operations');
      }
      const data = await response.json();
      setStatus({ loading: false, error: '', data });
    } catch (error) {
      setStatus({ loading: false, error: error.message || 'Failed to load status', data: null });
    }
  }, [apiBase, auth?.access, navigate, persistAuth]);

  const fetchRecentActivity = useCallback(async () => {
    if (!auth?.access) {
      return;
    }
    try {
      const response = await fetch(`${normalizeBase(rootApiBaseUrl)}/active-users/?limit=5`, {
        headers: {
          Authorization: `Bearer ${auth.access}`,
        },
        credentials: 'include',
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      setActivity(Array.isArray(data?.user_activities) ? data.user_activities.slice(0, 5) : []);
    } catch (error) {
      console.error('Failed to load activity', error);
    }
  }, [auth?.access, rootApiBaseUrl]);

  useEffect(() => {
    fetchStatus();
    fetchRecentActivity();
  }, [fetchStatus, fetchRecentActivity]);

  const handleLogout = useCallback(() => {
    persistAuth(null);
    navigate('/');
  }, [navigate, persistAuth]);

  if (!auth?.access) {
    return null;
  }

  return (
    <div className="network-ops-shell">
      <header className="network-ops-header">
        <div>
          <p className="network-ops-eyebrow">Network Operations</p>
          <h1>Realtime Operations Console</h1>
          <p className="network-ops-subtitle">
            Separate workspace for global network events, telemetry, and readiness updates.
          </p>
        </div>
        <div className="network-ops-account">
          <div>
            <strong>{auth?.user?.username || auth?.user?.email}</strong>
            <small>{auth?.user?.email}</small>
          </div>
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="network-ops-main">
        <section className="network-ops-card">
          <div className="card-header">
            <h2>Platform status</h2>
            <button type="button" className="secondary" onClick={fetchStatus} disabled={status.loading}>
              {status.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {status.error && <p className="error-text">{status.error}</p>}
          {status.loading && !status.error && <p>Loading network status…</p>}
          {status.data && !status.loading && (
            <div className="status-grid">
              <div>
                <span className="label">Module</span>
                <strong>{status.data.module}</strong>
              </div>
              <div>
                <span className="label">Status</span>
                <strong className="status-pill online">{status.data.status}</strong>
              </div>
              <div>
                <span className="label">Responding as</span>
                <strong>{status.data.user}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="network-ops-card">
          <h2>Recent operator activity</h2>
          {activity.length ? (
            <ul className="activity-feed">
              {activity.map((entry, index) => (
                <li key={`${entry.user_id}-${index}`}>
                  <strong>{entry.email}</strong>
                  <small>{entry.activity_type}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No activity captured yet.</p>
          )}
        </section>
      </main>

      <AppFooter apiBaseUrl={rootApiBaseUrl} />
    </div>
  );
}

export default NetworkOperationsDashboard;
