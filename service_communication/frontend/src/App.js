import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import Login from './component/Login';
import Dashboard from './component/Dashboard';
import UserActivity from './component/UserActivity';
import Guide from './component/Guide';
import OAuthCallback from './component/OAuthCallback';
import AdminRedirect from './component/AdminRedirect';
import NetworkOperationsDashboard from './component/NetworkOperationsDashboard';
import { AUTH_STORAGE_KEY } from './constants/storage';
import './App.css';

const sanitizeBase = (value) => value.replace(/\/+$/, '');

const resolveApiBases = () => {
  const provided = process.env.REACT_APP_API_BASE_URL;
  let rootBase;
  if (provided) {
    rootBase = sanitizeBase(
      provided.replace(/\/service-communications$/, '').replace(/\/network-operations$/, '')
    );
  } else if (window.location.hostname === 'localhost') {
    rootBase = 'http://localhost:8000/api';
  } else {
    rootBase = `${window.location.protocol}//${window.location.hostname}/api`;
  }
  const normalizedRoot = sanitizeBase(rootBase);
  return {
    root: normalizedRoot,
    service: `${normalizedRoot}/service-communications`,
    network: `${normalizedRoot}/network-operations`,
  };
};

const resolveLegacyBase = (rootApiBase) => {
  try {
    const parsed = new URL(rootApiBase);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (err) {
    return rootApiBase.replace(/\/api$/, '');
  }
};

function App() {
  const [{ root: rootApiBaseUrl, service: serviceApiBaseUrl, network: networkApiBaseUrl }] =
    useState(resolveApiBases);
  const legacyBaseUrl = useMemo(() => resolveLegacyBase(rootApiBaseUrl), [rootApiBaseUrl]);
  const [auth, setAuth] = useState(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const appScope = (process.env.REACT_APP_APP_SCOPE || 'combined').toLowerCase();
  const serviceEnabled = appScope !== 'network';
  const networkEnabled = appScope !== 'service';

  useEffect(() => {
    if (!auth) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [auth]);

  const defaultPath = networkEnabled && !serviceEnabled ? '/network-operations' : '/service-communications';

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            <Login
              apiBaseUrl={rootApiBaseUrl}
              serviceApiBaseUrl={serviceApiBaseUrl}
              auth={auth}
              setAuth={setAuth}
              homePath={defaultPath}
              productTitle={
                serviceEnabled ? 'Service Communication Portal' : 'Operations Access Gateway'
              }
              metaBaseUrl={rootApiBaseUrl}
            />
          }
        />
        <Route path="/guide" element={<Guide />} />
        {serviceEnabled && (
          <>
            <Route
              path="/dashboard"
              element={
                <Login
                  apiBaseUrl={rootApiBaseUrl}
                  serviceApiBaseUrl={serviceApiBaseUrl}
                  auth={auth}
                  setAuth={setAuth}
                  homePath="/service-communications"
                  productTitle="Service Communication Portal"
                  metaBaseUrl={rootApiBaseUrl}
                />
              }
            />
            <Route
              path="/service-communications"
              element={
                auth ? (
                  <Dashboard
                    apiBaseUrl={serviceApiBaseUrl}
                    metaBaseUrl={rootApiBaseUrl}
                    auth={auth}
                    setAuth={setAuth}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/user-activity"
              element={
                auth ? (
                  <UserActivity apiBaseUrl={rootApiBaseUrl} auth={auth} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
          </>
        )}
        {networkEnabled && (
          <Route
            path="/network-operations"
            element={
              auth ? (
                <NetworkOperationsDashboard
                  apiBaseUrl={networkApiBaseUrl}
                  rootApiBaseUrl={rootApiBaseUrl}
                  auth={auth}
                  setAuth={setAuth}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        )}
        <Route path="/admin/*" element={<AdminRedirect adminBaseUrl={legacyBaseUrl} />} />
        <Route path="/oauth2/callback" element={<OAuthCallback apiBaseUrl={legacyBaseUrl} />} />
        <Route path="*" element={<Navigate to={defaultPath} replace />} />
      </Routes>
    </Router>
  );
}

export default App;
