import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import { AUTH_STORAGE_KEY } from '../constants/storage';
import '../assets/LogicMonitor.css';

const SUB_NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'queue', label: 'Queue' },
  { id: 'mapping', label: 'Mapping Admin' },
];

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const readCookie = (name) => {
  if (!document?.cookie) return null;
  return (
    document.cookie
      .split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split('=')
      ?.slice(1)
      ?.join('=') || null
  );
};

const normalizeBase = (value) => {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
};

const buildMappingForm = (entry) => ({
  vendor_site_code: entry?.vendor_site_code || '',
  lm_site_code: entry?.lm_site_code || '',
  source: entry?.source || 'monthly',
  notes: entry?.notes || '',
});

const canReplayQueueItem = (item) => {
  const mapped = Boolean(item?.lm_site_code && String(item.lm_site_code).trim());
  const isPendingMapped = item?.status === 'pending' && mapped;
  const hasError = Boolean(item?.last_error && String(item.last_error).trim());
  const isActiveWithError = item?.status === 'active' && hasError;
  return isPendingMapped || isActiveWithError;
};

function SdtAutomationDashboard({ apiBaseUrl, metaBaseUrl, auth, setAuth }) {
  const navigate = useNavigate();
  const refreshPromiseRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const settingsMenuRef = useRef(null);

  const [activeSubNav, setActiveSubNav] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const [overview, setOverview] = useState({ counts: {}, mapping_missing: 0, mapping_guidance: '' });
  const [queueItems, setQueueItems] = useState([]);
  const [mappingItems, setMappingItems] = useState([]);

  const [queueFilter, setQueueFilter] = useState('all');
  const [queueSearchInput, setQueueSearchInput] = useState('');
  const [queueSearch, setQueueSearch] = useState('');

  const [selectedQueueItem, setSelectedQueueItem] = useState(null);
  const [queueDetail, setQueueDetail] = useState(null);

  const [showMappingModal, setShowMappingModal] = useState(false);
  const [activeMapping, setActiveMapping] = useState(null);
  const [mappingForm, setMappingForm] = useState(buildMappingForm());

  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);

  const token = auth?.access;
  const apiBase = useMemo(() => normalizeBase(apiBaseUrl), [apiBaseUrl]);
  const rootApiBase = useMemo(() => normalizeBase(metaBaseUrl || apiBaseUrl), [metaBaseUrl, apiBaseUrl]);
  const legacyBaseUrl = useMemo(() => {
    if (!apiBase) return '';
    try {
      const parsed = new URL(apiBase);
      return `${parsed.protocol}//${parsed.host}`;
    } catch (err) {
      return apiBase.replace(/\/api\/?$/, '') || apiBase;
    }
  }, [apiBase]);

  const profileDisplayName = useMemo(() => {
    const first = (auth?.user?.first_name || '').trim();
    if (first) return first;
    const fallback = (auth?.user?.name || '').trim();
    if (fallback) {
      const [firstWord] = fallback.split(/\s+/);
      if (firstWord) return firstWord;
    }
    return 'SDT Ops User';
  }, [auth]);

  const userInitials = useMemo(() => {
    const first = auth?.user?.first_name || '';
    const last = auth?.user?.last_name || '';
    const initials = `${first.slice(0, 1)}${last.slice(0, 1)}`.trim();
    if (initials) return initials.toUpperCase();
    const email = auth?.user?.email || '';
    return email.slice(0, 2).toUpperCase() || 'SD';
  }, [auth]);

  const showToast = useCallback((message) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    if (!message) {
      setToastMessage('');
      return;
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage('');
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (!settingsMenuRef.current?.contains(event.target)) {
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

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

  const handleSessionExpired = useCallback(
    (message = 'Session expired. Please sign in again.') => {
      setError(message);
      persistAuth(null);
      navigate('/');
    },
    [navigate, persistAuth]
  );

  const fetchWithToken = useCallback(
    (path, options = {}, forcedToken) => {
      const opts = { ...options };
      const headers = { ...(opts.headers || {}) };
      const requestToken = forcedToken || token;
      const shouldSerializeBody = opts.body && !(opts.body instanceof FormData);
      if (!opts.body || shouldSerializeBody) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      }
      if (requestToken) {
        headers.Authorization = `Bearer ${requestToken}`;
      }
      opts.headers = headers;
      if (shouldSerializeBody && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
      }
      return fetch(`${apiBase}${path}`, {
        credentials: 'include',
        ...opts,
      });
    },
    [apiBase, token]
  );


  const refreshAccessToken = useCallback(async () => {
    if (!auth?.refresh) {
      return null;
    }
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = (async () => {
        try {
          const response = await fetch(`${apiBase}/auth/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ refresh: auth.refresh }),
          });
          let data = null;
          try {
            data = await response.json();
          } catch (err) {
            // ignore
          }
          if (!response.ok || !data?.access) {
            return null;
          }
          const nextAuth = {
            ...(auth || {}),
            access: data.access,
            refresh: data.refresh || auth.refresh,
          };
          persistAuth(nextAuth);
          return nextAuth.access;
        } catch (err) {
          return null;
        }
      })().finally(() => {
        refreshPromiseRef.current = null;
      });
    }
    return refreshPromiseRef.current;
  }, [apiBase, auth, persistAuth]);

  const apiRequest = useCallback(
    async (path, options = {}, allowRefresh = true) => {
      const execute = async (overrideToken) => {
        const response = await fetchWithToken(path, options, overrideToken);
        if (response.status === 204) return null;
        let data = null;
        try {
          data = await response.json();
        } catch (err) {
          // ignore parse issue
        }
        if (!response.ok) {
          const detail =
            data?.detail ||
            data?.message ||
            (data && typeof data === 'object'
              ? JSON.stringify(data)
              : typeof data === 'string'
              ? data
              : 'Request failed');
          const error = new Error(detail);
          error.status = response.status;
          error.responseData = data;
          throw error;
        }
        return data;
      };

      try {
        return await execute();
      } catch (err) {
        if (err.status === 401) {
          if (allowRefresh && auth?.refresh) {
            const newAccess = await refreshAccessToken();
            if (newAccess) return execute(newAccess);
          }
          handleSessionExpired();
          throw err;
        }
        throw err;
      }
    },
    [auth?.refresh, fetchWithToken, handleSessionExpired, refreshAccessToken]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overviewData, queueData, mappingData] = await Promise.all([
        apiRequest('/queue/overview/'),
        apiRequest('/queue/'),
        apiRequest('/site-mappings/'),
      ]);
      setOverview(overviewData || { counts: {}, mapping_missing: 0, mapping_guidance: '' });
      setQueueItems(Array.isArray(queueData?.results) ? queueData.results : queueData || []);
      setMappingItems(Array.isArray(mappingData?.results) ? mappingData.results : mappingData || []);
    } catch (err) {
      setError(err.message || 'Failed to load SDT queue data.');
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    if (!auth?.access) {
      navigate('/');
      return;
    }
    loadData();
  }, [auth?.access, loadData, navigate]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setQueueSearch(queueSearchInput.trim());
    }, 250);
    return () => clearTimeout(handler);
  }, [queueSearchInput]);

  const filteredQueueItems = useMemo(() => {
    let filtered = queueItems;
    if (queueFilter !== 'all') {
      filtered = filtered.filter((entry) => entry.status === queueFilter);
    }
    if (queueSearch) {
      const q = queueSearch.toLowerCase();
      filtered = filtered.filter((entry) => {
        return (
          entry.maintenance_id?.toLowerCase().includes(q) ||
          entry.vendor_site_code?.toLowerCase().includes(q) ||
          entry.lm_site_code?.toLowerCase().includes(q)
        );
      });
    }
    return filtered;
  }, [queueItems, queueFilter, queueSearch]);

  const handleLogout = useCallback(async () => {
    setShowSettingsDropdown(false);
    const accessToken = auth?.access;
    let redirected = false;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('scSkipSessionLogin', '1');
      }
      const headers = {};
      const csrfToken = readCookie('csrftoken');
      if (csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
      }
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const response = await fetch(`${legacyBaseUrl}/logout/`, {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      let data = null;
      try {
        data = await response.json();
      } catch (err) {
        // ignore parse issue
      }
      if (data?.success && data?.logout_url) {
        redirected = true;
        window.location.assign(data.logout_url);
      }
    } catch (err) {
      // ignore
    } finally {
      persistAuth(null);
      if (!redirected) {
        navigate('/');
      }
    }
  }, [auth?.access, legacyBaseUrl, navigate, persistAuth]);

  const handleQueueDetail = useCallback(
    async (item) => {
      if (!item?.id) return;
      setSelectedQueueItem(item);
      setQueueDetail(null);
      setLoading(true);
      setError('');
      try {
        const detail = await apiRequest(`/queue/${item.id}/`);
        setQueueDetail(detail);
      } catch (err) {
        setError(err.message || 'Unable to load queue detail.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest]
  );

  const handleReplay = useCallback(
    async (item) => {
      if (!item?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/queue/${item.id}/replay/`, { method: 'POST' });
        showToast('Replay queued');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to replay queue item.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const handleCancel = useCallback(
    async (item) => {
      if (!item?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/queue/${item.id}/cancel/`, { method: 'POST' });
        showToast('Queue item cancelled');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to cancel queue item.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const handleRunScheduler = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest('/scheduler/tick/', { method: 'POST' });
      showToast(`Scheduler tick: activated ${result?.activated || 0}, expired ${result?.expired || 0}`);
      await loadData();
    } catch (err) {
      setError(err.message || 'Unable to run scheduler tick.');
    } finally {
      setLoading(false);
    }
  }, [apiRequest, loadData, showToast]);

  const openMappingModal = useCallback((mapping = null) => {
    setActiveMapping(mapping);
    setMappingForm(buildMappingForm(mapping));
    setShowMappingModal(true);
  }, []);

  const handleMappingSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
        const payload = {
          ...mappingForm,
          vendor_site_code: mappingForm.vendor_site_code.trim(),
          lm_site_code: mappingForm.lm_site_code.trim(),
          source: mappingForm.source.trim(),
          notes: mappingForm.notes.trim(),
        };
        if (activeMapping?.id) {
          await apiRequest(`/site-mappings/${activeMapping.id}/`, { method: 'PUT', body: payload });
          showToast('Mapping updated');
        } else {
          await apiRequest('/site-mappings/', { method: 'POST', body: payload });
          showToast('Mapping created');
        }
        setShowMappingModal(false);
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to save mapping.');
      } finally {
        setLoading(false);
      }
    },
    [activeMapping, apiRequest, loadData, mappingForm, showToast]
  );

  const handleMappingDelete = useCallback(
    async (mapping) => {
      if (!mapping?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/site-mappings/${mapping.id}/`, { method: 'DELETE' });
        showToast('Mapping removed');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to delete mapping.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  if (!auth?.access) {
    return null;
  }

  return (
    <div className="app-shell logic-monitor">
      <header className="app-header sc-header">
        <div className="sc-branding">
          <img src="logo_left.png" alt="LogicMonitor" className="sc-logo" />
          <div>
            <h1>Logic Monitor SDT</h1>
            <p>Queue-driven SDT automation with monthly site mapping governance.</p>
          </div>
        </div>
        <div className="header-actions sc-header-actions">
          <img src="logo_right.png" alt="Operations Partner" className="sc-logo sc-logo-compact" />
          <div className="sc-settings-trigger" ref={settingsMenuRef}>
            <button
              type="button"
              className={`icon-button ${showSettingsDropdown ? 'active' : ''}`}
              onClick={() => setShowSettingsDropdown((prev) => !prev)}
              aria-expanded={showSettingsDropdown}
              aria-label="Open settings"
            >
              ⚙
            </button>
            {showSettingsDropdown && (
              <div className="sc-settings-dropdown">
                <div className="sc-profile-card">
                  <div className="sc-avatar">{userInitials}</div>
                  <div className="sc-profile-details">
                    <span>{profileDisplayName}</span>
                    <small>{auth?.user?.email}</small>
                  </div>
                </div>
                <button type="button" onClick={handleLogout}>
                  ↩ Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className="sc-subnav">
        {SUB_NAV_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`subnav-item ${activeSubNav === section.id ? 'active' : ''}`}
            onClick={() => setActiveSubNav(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {error && <div className="alert">{error}</div>}

        {activeSubNav === 'overview' && (
          <section className="panel" data-section="overview">
            <div className="panel-header">
              <h2>Queue health</h2>
              <div className="list-actions">
                <button type="button" onClick={handleRunScheduler} disabled={loading}>
                  Run scheduler tick
                </button>
                <button type="button" className="secondary" onClick={loadData} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <p>Pending</p>
                <h3 className="summary-value">{overview?.counts?.pending || 0}</h3>
              </div>
              <div className="summary-card">
                <p>Active</p>
                <h3 className="summary-value">{overview?.counts?.active || 0}</h3>
              </div>
              <div className="summary-card">
                <p>Completed</p>
                <h3 className="summary-value">{overview?.counts?.completed || 0}</h3>
              </div>
              <div className="summary-card">
                <p>Cancelled</p>
                <h3 className="summary-value">{overview?.counts?.cancelled || 0}</h3>
              </div>
              <div className="summary-card">
                <p>Mapping missing</p>
                <h3 className="summary-value">{overview?.mapping_missing || 0}</h3>
                <small>{overview?.mapping_guidance || 'Updated monthly'}</small>
              </div>
            </div>
          </section>
        )}

        {activeSubNav === 'queue' && (
          <section className="panel" data-section="queue">
            <div className="panel-header compact">
              <h2>SDT queue</h2>
              <div className="incident-filter-chips">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.id}
                    className={`filter-chip ${queueFilter === filter.id ? 'active' : ''}`}
                    onClick={() => setQueueFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-field" style={{ marginBottom: '1rem' }}>
              <span>Search queue</span>
              <input
                value={queueSearchInput}
                onChange={(event) => setQueueSearchInput(event.target.value)}
                placeholder="maintenance_id, vendor_site_code, lm_site_code"
              />
            </div>
            {filteredQueueItems.length ? (
              <ul className="list-view">
                {filteredQueueItems.map((entry) => (
                  <li key={entry.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{entry.maintenance_id}</strong>
                        <p>
                          Vendor: {entry.vendor_site_code} · LM: {entry.lm_site_code || 'missing'}
                        </p>
                        <small>
                          Status: {entry.status} · Start UTC: {formatDateTime(entry.start_time_utc)} · End UTC:{' '}
                          {formatDateTime(entry.end_time_utc)}
                        </small>
                        {entry.last_error ? <small>Error: {entry.last_error}</small> : null}
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => handleQueueDetail(entry)}>
                          Details
                        </button>
                        {canReplayQueueItem(entry) && (
                          <button type="button" onClick={() => handleReplay(entry)}>
                            Replay
                          </button>
                        )}
                        {(entry.status === 'pending' || entry.status === 'active') && (
                          <button type="button" className="danger" onClick={() => handleCancel(entry)}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No queue entries matched.</p>
            )}
          </section>
        )}

        {activeSubNav === 'mapping' && (
          <section className="panel" data-section="mapping">
            <div className="panel-header">
              <h2>Vendor to LM site mapping</h2>
              <button type="button" className="primary" onClick={() => openMappingModal()}>
                Add mapping
              </button>
            </div>
            <p className="empty-state" style={{ marginBottom: '1rem' }}>
              Updated monthly: review and refresh site mappings to avoid activation blocks.
            </p>
            {mappingItems.length ? (
              <ul className="list-view">
                {mappingItems.map((entry) => (
                  <li key={entry.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{entry.vendor_site_code}</strong>
                        <p>LM site code: {entry.lm_site_code}</p>
                        <small>
                          Source: {entry.source || 'manual'} · Updated: {formatDateTime(entry.updated_at)}
                        </small>
                        {entry.notes ? <small>Notes: {entry.notes}</small> : null}
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => openMappingModal(entry)}>
                          Edit
                        </button>
                        <button type="button" className="danger" onClick={() => handleMappingDelete(entry)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No mappings configured yet.</p>
            )}
          </section>
        )}
      </main>

      {selectedQueueItem && queueDetail && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>Queue detail</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setSelectedQueueItem(null);
                  setQueueDetail(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <div className="incident-details-card">
                <h4>{queueDetail.maintenance_id}</h4>
                <p>
                  Vendor: {queueDetail.vendor_site_code} · LM site: {queueDetail.lm_site_code || 'missing'}
                </p>
                <p>
                  Status: {queueDetail.status} · Retry count: {queueDetail.retry_count}
                </p>
                <p>
                  Start UTC: {formatDateTime(queueDetail.start_time_utc)} · End UTC:{' '}
                  {formatDateTime(queueDetail.end_time_utc)}
                </p>
                <p>
                  Mapping status:{' '}
                  {queueDetail.lm_site_code ? 'mapped' : 'missing (updated monthly guidance applies)'}
                </p>
                <div className="template-preview" style={{ marginTop: '1rem' }}>
                  <div className="template-preview-section">
                    <span>Circuit + targets</span>
                    <pre>
                      {JSON.stringify(
                        {
                          circuit_type: queueDetail.circuit_type,
                          target_type: queueDetail.target_type,
                          target_ids: queueDetail.target_ids,
                          lm_sdt_ids: queueDetail.lm_sdt_ids,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                  <div className="template-preview-section">
                    <span>Verification</span>
                    <pre>
                      {JSON.stringify(
                        {
                          verification_status: queueDetail.verification_status,
                          verification_details: queueDetail.verification_details,
                          last_error: queueDetail.last_error,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                  <div className="template-preview-section">
                    <span>Parsed payload</span>
                    <pre>{JSON.stringify(queueDetail.parsed_payload || {}, null, 2)}</pre>
                  </div>
                </div>
                <div className="incident-action-buttons">
                  {canReplayQueueItem(queueDetail) && (
                    <button type="button" className="primary" onClick={() => handleReplay(queueDetail)}>
                      Replay activation
                    </button>
                  )}
                  {(queueDetail.status === 'pending' || queueDetail.status === 'active') && (
                    <button type="button" className="danger" onClick={() => handleCancel(queueDetail)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMappingModal && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>{activeMapping ? 'Edit mapping' : 'Add mapping'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowMappingModal(false)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <form className="sc-form" onSubmit={handleMappingSubmit}>
                <label className="form-field">
                  <span>Vendor site code</span>
                  <input
                    value={mappingForm.vendor_site_code}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, vendor_site_code: event.target.value }))
                    }
                    required
                  />
                </label>
                <label className="form-field">
                  <span>LM site code</span>
                  <input
                    value={mappingForm.lm_site_code}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, lm_site_code: event.target.value }))
                    }
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Source</span>
                  <input
                    value={mappingForm.source}
                    onChange={(event) => setMappingForm((prev) => ({ ...prev, source: event.target.value }))}
                    placeholder="monthly"
                  />
                </label>
                <label className="form-field">
                  <span>Notes</span>
                  <textarea
                    rows="3"
                    value={mappingForm.notes}
                    onChange={(event) => setMappingForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={loading}>
                    Save mapping
                  </button>
                  <button type="button" className="secondary" onClick={() => setShowMappingModal(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="sc-toast">{toastMessage}</div>}
      <AppFooter apiBaseUrl={rootApiBase} />
    </div>
  );
}

export default SdtAutomationDashboard;
