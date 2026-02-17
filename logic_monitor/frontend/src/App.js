import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import Login from './component/Login';
import OAuthCallback from './component/OAuthCallback';
import AdminRedirect from './component/AdminRedirect';
import NetworkOperationsDashboard from './component/NetworkOperationsDashboard';
import AlertIngestionDashboard from './component/AlertIngestionDashboard';
import SdtAutomationDashboard from './component/SdtAutomationDashboard';
import { AUTH_STORAGE_KEY } from './constants/storage';
import './App.css';

const sanitizeBase = (value) => value.replace(/\/+$/, '');

const resolveApiBases = () => {
  const provided = process.env.REACT_APP_API_BASE_URL;
  let rootBase;
  if (provided) {
    rootBase = sanitizeBase(
      provided
        .replace(/\/network-operations$/, '')
        .replace(/\/alert-ingestion$/, '')
        .replace(/\/sdt-automation$/, '')
    );
  } else if (window.location.hostname === 'localhost') {
    rootBase = 'http://localhost:8000/api';
  } else {
    rootBase = `${window.location.protocol}//${window.location.hostname}/api`;
  }
  const normalizedRoot = sanitizeBase(rootBase);
  return {
    root: normalizedRoot,
    network: `${normalizedRoot}/network-operations`,
    alerts: `${normalizedRoot}/alert-ingestion`,
    sdt: `${normalizedRoot}/sdt-automation`,
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
  const [{ root: rootApiBaseUrl, network: networkApiBaseUrl, alerts: alertsApiBaseUrl, sdt: sdtApiBaseUrl }] =
    useState(resolveApiBases);
  const legacyBaseUrl = useMemo(() => resolveLegacyBase(rootApiBaseUrl), [rootApiBaseUrl]);
  const [auth, setAuth] = useState(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  });
  const appScope = (process.env.REACT_APP_APP_SCOPE || 'alerts').toLowerCase();
  const alertEnabled = appScope === 'combined' || appScope === 'alerts';
  const networkEnabled = appScope === 'combined' || appScope === 'network';
  const sdtEnabled = appScope === 'combined' || appScope === 'sdt';

  useEffect(() => {
    if (!auth) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [auth]);

  const defaultPath = alertEnabled ? '/alert-ingestion' : sdtEnabled ? '/sdt-automation' : '/network-operations';
  const serviceApiBaseUrl = alertEnabled ? alertsApiBaseUrl : sdtEnabled ? sdtApiBaseUrl : alertsApiBaseUrl;

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
                alertEnabled
                  ? 'LogicMonitor Alert Console'
                  : sdtEnabled
                  ? 'Logic Monitor SDT'
                  : 'Operations Access Gateway'
              }
              metaBaseUrl={rootApiBaseUrl}
            />
          }
        />
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
        {alertEnabled && (
          <Route
            path="/alert-ingestion"
            element={
              auth ? (
                <AlertIngestionDashboard
                  apiBaseUrl={alertsApiBaseUrl}
                  metaBaseUrl={rootApiBaseUrl}
                  auth={auth}
                  setAuth={setAuth}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        )}
        {sdtEnabled && (
          <Route
            path="/sdt-automation"
            element={
              auth ? (
                <SdtAutomationDashboard
                  apiBaseUrl={sdtApiBaseUrl}
                  metaBaseUrl={rootApiBaseUrl}
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
