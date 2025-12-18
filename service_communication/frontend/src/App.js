import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import Login from './component/Login';
import Dashboard from './component/Dashboard';
import UserActivity from './component/UserActivity';
import OAuthCallback from './component/OAuthCallback';
import AdminRedirect from './component/AdminRedirect';
import { AUTH_STORAGE_KEY } from './constants/storage';
import './App.css';

const resolveApiBase = () => {
  const provided = process.env.REACT_APP_API_BASE_URL;
  if (provided) {
    return provided.replace(/\/$/, '');
  }
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:8000/api';
  }
  return `${window.location.protocol}//${window.location.hostname}/api`;
};

const resolveLegacyBase = (apiBaseUrl) => {
  try {
    const parsed = new URL(apiBaseUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (err) {
    return apiBaseUrl.replace(/\/api$/, '');
  }
};

function App() {
  const [apiBaseUrl] = useState(resolveApiBase);
  const baseUrl = useMemo(() => resolveLegacyBase(apiBaseUrl), [apiBaseUrl]);
  const [auth, setAuth] = useState(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    if (!auth) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [auth]);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login apiBaseUrl={apiBaseUrl} auth={auth} setAuth={setAuth} />} />
        <Route
          path="/dashboard"
          element={<Login apiBaseUrl={apiBaseUrl} auth={auth} setAuth={setAuth} />}
        />
        <Route
          path="/service-communications"
          element={
            auth ? (
              <Dashboard apiBaseUrl={apiBaseUrl} auth={auth} setAuth={setAuth} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="/admin/*" element={<AdminRedirect adminBaseUrl={baseUrl} />} />
        <Route path="/user-activity" element={<UserActivity apiBaseUrl={apiBaseUrl} />} />
        <Route path="/oauth2/callback" element={<OAuthCallback apiBaseUrl={baseUrl} />} />
        <Route
          path="*"
          element={<Navigate to={auth ? '/service-communications' : '/'} replace />}
        />
      </Routes>
    </Router>
  );
}

export default App;
