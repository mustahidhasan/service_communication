import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import { AUTH_STORAGE_KEY } from '../constants/storage';
import '../assets/LogicMonitor.css';

const SUB_NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'mailboxes', label: 'Mailboxes' },
  { id: 'rules', label: 'Rules' },
  { id: 'events', label: 'Events' },
  { id: 'deliveries', label: 'Deliveries' },
];

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'cleared', label: 'Cleared' },
  { id: 'failed', label: 'Failed' },
];

const DELIVERY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'success', label: 'Success' },
  { id: 'failed', label: 'Failed' },
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
  }).format(date);
};

const buildMailboxForm = (mailbox) => ({
  name: mailbox?.name || '',
  address: mailbox?.address || '',
  ingestion_mode: mailbox?.ingestion_mode || 'subscription',
  allowlist_domains: Array.isArray(mailbox?.allowlist_domains)
    ? mailbox.allowlist_domains.join(', ')
    : '',
  is_active: mailbox?.is_active ?? true,
});

const buildParserForm = (rule) => ({
  name: rule?.name || '',
  priority: rule?.priority ?? 100,
  sender_contains: rule?.sender_contains || '',
  subject_contains: rule?.subject_contains || '',
  body_regex: rule?.body_regex || '',
  resource_regex: rule?.resource_regex || '',
  alert_name_regex: rule?.alert_name_regex || '',
  severity_regex: rule?.severity_regex || '',
  state_regex: rule?.state_regex || '',
  timestamp_regex: rule?.timestamp_regex || '',
  severity_map: rule?.severity_map ? JSON.stringify(rule.severity_map, null, 2) : '{}',
  state_map: rule?.state_map ? JSON.stringify(rule.state_map, null, 2) : '{}',
  is_active: rule?.is_active ?? true,
});

const buildMappingForm = (rule) => ({
  name: rule?.name || '',
  priority: rule?.priority ?? 100,
  sender_contains: rule?.sender_contains || '',
  subject_contains: rule?.subject_contains || '',
  body_regex: rule?.body_regex || '',
  header_regex: rule?.header_regex || '',
  resource_identifier: rule?.resource_identifier || '',
  alert_category: rule?.alert_category || '',
  severity_override: rule?.severity_override || '',
  alert_name_override: rule?.alert_name_override || '',
  source_system: rule?.source_system || '',
  notes: rule?.notes || '',
  is_active: rule?.is_active ?? true,
});

function AlertIngestionDashboard({ apiBaseUrl, metaBaseUrl, auth, setAuth }) {
  const navigate = useNavigate();
  const refreshPromiseRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const settingsMenuRef = useRef(null);

  const [activeSubNav, setActiveSubNav] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const [mailboxes, setMailboxes] = useState([]);
  const [parsingRules, setParsingRules] = useState([]);
  const [mappingRules, setMappingRules] = useState([]);
  const [events, setEvents] = useState([]);
  const [deliveries, setDeliveries] = useState([]);

  const [eventFilter, setEventFilter] = useState('all');
  const [eventSearch, setEventSearch] = useState('');
  const [eventSearchInput, setEventSearchInput] = useState('');
  const [deliveriesFilter, setDeliveriesFilter] = useState('all');

  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showMailboxModal, setShowMailboxModal] = useState(false);
  const [activeMailbox, setActiveMailbox] = useState(null);
  const [mailboxForm, setMailboxForm] = useState(buildMailboxForm());

  const [showParserModal, setShowParserModal] = useState(false);
  const [activeParserRule, setActiveParserRule] = useState(null);
  const [parserForm, setParserForm] = useState(buildParserForm());

  const [showMappingModal, setShowMappingModal] = useState(false);
  const [activeMappingRule, setActiveMappingRule] = useState(null);
  const [mappingForm, setMappingForm] = useState(buildMappingForm());

  const [ruleTestForm, setRuleTestForm] = useState({
    sender: '',
    subject: '',
    body: '',
    headers: '{}',
  });
  const [ruleTestResult, setRuleTestResult] = useState(null);

  const [timelineEvent, setTimelineEvent] = useState(null);
  const [timelineData, setTimelineData] = useState({ emails: [], deliveries: [] });
  const [timelineLoading, setTimelineLoading] = useState(false);

  const token = auth?.access;
  const apiBase = useMemo(() => normalizeBase(apiBaseUrl), [apiBaseUrl]);
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
    return 'Alert Ops User';
  }, [auth]);

  const userInitials = useMemo(() => {
    const first = auth?.user?.first_name || '';
    const last = auth?.user?.last_name || '';
    const initials = `${first.slice(0, 1)}${last.slice(0, 1)}`.trim();
    if (initials) return initials.toUpperCase();
    const email = auth?.user?.email || '';
    return email.slice(0, 2).toUpperCase() || 'AI';
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
            // ignore parsing issue
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
        if (response.status === 204) {
          return null;
        }
        let data = null;
        try {
          data = await response.json();
        } catch (err) {
          // ignore json parse issues for empty bodies
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
            if (newAccess) {
              return execute(newAccess);
            }
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
      const [mailboxData, parserData, mappingData, eventData, deliveryData] = await Promise.all([
        apiRequest('/mailboxes/'),
        apiRequest('/parsers/'),
        apiRequest('/rules/'),
        apiRequest('/events/'),
        apiRequest('/deliveries/'),
      ]);
      setMailboxes(Array.isArray(mailboxData?.results) ? mailboxData.results : mailboxData || []);
      setParsingRules(Array.isArray(parserData?.results) ? parserData.results : parserData || []);
      setMappingRules(Array.isArray(mappingData?.results) ? mappingData.results : mappingData || []);
      setEvents(Array.isArray(eventData?.results) ? eventData.results : eventData || []);
      setDeliveries(Array.isArray(deliveryData?.results) ? deliveryData.results : deliveryData || []);
    } catch (err) {
      setError(err.message || 'Failed to load alert data.');
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
      setEventSearch(eventSearchInput.trim());
    }, 350);
    return () => clearTimeout(handler);
  }, [eventSearchInput]);

  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (eventFilter !== 'all') {
      filtered = filtered.filter((event) => event.status === eventFilter);
    }
    if (eventSearch) {
      const lower = eventSearch.toLowerCase();
      filtered = filtered.filter((event) => {
        return (
          event.correlation_key?.toLowerCase().includes(lower) ||
          event.alert_name?.toLowerCase().includes(lower) ||
          event.resource_identifier?.toLowerCase().includes(lower)
        );
      });
    }
    return filtered;
  }, [events, eventFilter, eventSearch]);

  const filteredDeliveries = useMemo(() => {
    if (deliveriesFilter === 'all') {
      return deliveries;
    }
    return deliveries.filter((delivery) => delivery.status === deliveriesFilter);
  }, [deliveries, deliveriesFilter]);

  const summaryCounts = useMemo(() => {
    return {
      total: events.length,
      open: events.filter((event) => event.status === 'open').length,
      cleared: events.filter((event) => event.status === 'cleared').length,
      failed: events.filter((event) => event.status === 'failed').length,
    };
  }, [events]);

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
        // ignore parse issues
      }
      if (data?.success && data?.logout_url) {
        redirected = true;
        window.location.assign(data.logout_url);
      }
    } catch (err) {
      // ignore logout errors
    } finally {
      persistAuth(null);
      if (!redirected) {
        navigate('/');
      }
    }
  }, [auth?.access, legacyBaseUrl, navigate, persistAuth]);

  const openMailboxModal = useCallback((mailbox = null) => {
    setActiveMailbox(mailbox);
    setMailboxForm(buildMailboxForm(mailbox));
    setShowMailboxModal(true);
  }, []);

  const handleMailboxSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
        const payload = {
          ...mailboxForm,
          allowlist_domains: mailboxForm.allowlist_domains
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        };
        if (activeMailbox?.id) {
          await apiRequest(`/mailboxes/${activeMailbox.id}/`, {
            method: 'PUT',
            body: payload,
          });
          showToast('Mailbox updated');
        } else {
          await apiRequest('/mailboxes/', {
            method: 'POST',
            body: payload,
          });
          showToast('Mailbox created');
        }
        setShowMailboxModal(false);
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to save mailbox.');
      } finally {
        setLoading(false);
      }
    },
    [activeMailbox, apiRequest, loadData, mailboxForm, showToast]
  );

  const handleMailboxDelete = useCallback(
    async (mailbox) => {
      if (!mailbox?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/mailboxes/${mailbox.id}/`, { method: 'DELETE' });
        showToast('Mailbox removed');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to delete mailbox.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const handlePollMailbox = useCallback(
    async (mailbox) => {
      if (!mailbox?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/mailboxes/${mailbox.id}/poll/`, { method: 'POST' });
        showToast('Mailbox poll completed');
        await loadData();
      } catch (err) {
        setError(err.message || 'Mailbox poll failed.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const openParserModal = useCallback((rule = null) => {
    setActiveParserRule(rule);
    setParserForm(buildParserForm(rule));
    setShowParserModal(true);
  }, []);

  const handleParserSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
        const payload = {
          ...parserForm,
          severity_map: JSON.parse(parserForm.severity_map || '{}'),
          state_map: JSON.parse(parserForm.state_map || '{}'),
        };
        if (activeParserRule?.id) {
          await apiRequest(`/parsers/${activeParserRule.id}/`, {
            method: 'PUT',
            body: payload,
          });
          showToast('Parser rule updated');
        } else {
          await apiRequest('/parsers/', {
            method: 'POST',
            body: payload,
          });
          showToast('Parser rule created');
        }
        setShowParserModal(false);
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to save parser rule.');
      } finally {
        setLoading(false);
      }
    },
    [activeParserRule, apiRequest, loadData, parserForm, showToast]
  );

  const handleParserDelete = useCallback(
    async (rule) => {
      if (!rule?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/parsers/${rule.id}/`, { method: 'DELETE' });
        showToast('Parser rule removed');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to delete parser rule.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const openMappingModal = useCallback((rule = null) => {
    setActiveMappingRule(rule);
    setMappingForm(buildMappingForm(rule));
    setShowMappingModal(true);
  }, []);

  const handleMappingSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
        if (activeMappingRule?.id) {
          await apiRequest(`/rules/${activeMappingRule.id}/`, {
            method: 'PUT',
            body: mappingForm,
          });
          showToast('Mapping rule updated');
        } else {
          await apiRequest('/rules/', {
            method: 'POST',
            body: mappingForm,
          });
          showToast('Mapping rule created');
        }
        setShowMappingModal(false);
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to save mapping rule.');
      } finally {
        setLoading(false);
      }
    },
    [activeMappingRule, apiRequest, loadData, mappingForm, showToast]
  );

  const handleMappingDelete = useCallback(
    async (rule) => {
      if (!rule?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/rules/${rule.id}/`, { method: 'DELETE' });
        showToast('Mapping rule removed');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to delete mapping rule.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const handleRuleTest = useCallback(
    async (event) => {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
        const payload = {
          sender: ruleTestForm.sender,
          subject: ruleTestForm.subject,
          body: ruleTestForm.body,
          headers: JSON.parse(ruleTestForm.headers || '{}'),
        };
        const data = await apiRequest('/rules/test/', { method: 'POST', body: payload });
        setRuleTestResult(data);
        showToast('Rule test complete');
      } catch (err) {
        setError(err.message || 'Unable to test rule.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, ruleTestForm, showToast]
  );

  const handleReplayEvent = useCallback(
    async (event) => {
      if (!event?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/events/${event.id}/replay/`, { method: 'POST' });
        showToast('Delivery replay queued');
        await loadData();
      } catch (err) {
        setError(err.message || 'Replay failed.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const handleTimelineOpen = useCallback(
    async (eventItem) => {
      if (!eventItem?.id) return;
      setTimelineEvent(eventItem);
      setTimelineLoading(true);
      try {
        const data = await apiRequest(`/events/${eventItem.id}/timeline/`);
        setTimelineData({
          emails: Array.isArray(data?.emails) ? data.emails : [],
          deliveries: Array.isArray(data?.deliveries) ? data.deliveries : [],
        });
      } catch (err) {
        setError(err.message || 'Unable to load timeline.');
      } finally {
        setTimelineLoading(false);
      }
    },
    [apiRequest]
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
            <h1>LogicMonitor</h1>
            <p>Email-driven alert normalization and delivery</p>
          </div>
        </div>
        <div className="header-actions sc-header-actions">
          <img src="logo_right.png" alt="Operations Partner" className="sc-logo sc-logo-compact" />
          <div className="sc-settings-trigger" ref={settingsMenuRef}>
            <button
              type="button"
              className={`icon-button ${showSettingsDropdown ? 'active' : ''}`}
              aria-haspopup="menu"
              aria-controls="sc-settings-menu"
              aria-expanded={showSettingsDropdown}
              onClick={() => setShowSettingsDropdown((prev) => !prev)}
            >
              ⚙️
            </button>
            {showSettingsDropdown && (
              <div className="sc-settings-dropdown" id="sc-settings-menu" role="menu">
                <div className="sc-profile-card" title={profileDisplayName}>
                  <div className="sc-avatar">{userInitials}</div>
                  <div className="sc-profile-details">
                    <span>{profileDisplayName}</span>
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
            type="button"
            key={section.id}
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
              <h2>Alert pulse</h2>
              <button type="button" className="secondary" onClick={loadData}>
                Refresh
              </button>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <h3>Total events</h3>
                <div className="summary-value">{summaryCounts.total}</div>
              </div>
              <div className="summary-card">
                <h3>Open</h3>
                <div className="summary-value">{summaryCounts.open}</div>
              </div>
              <div className="summary-card">
                <h3>Cleared</h3>
                <div className="summary-value">{summaryCounts.cleared}</div>
              </div>
              <div className="summary-card">
                <h3>Failed</h3>
                <div className="summary-value">{summaryCounts.failed}</div>
              </div>
            </div>
          </section>
        )}

        {activeSubNav === 'mailboxes' && (
          <section className="panel" data-section="mailboxes">
            <div className="panel-header">
              <h2>Mailboxes</h2>
              <button type="button" className="primary" onClick={() => openMailboxModal()}>
                Add mailbox
              </button>
            </div>
            {mailboxes.length ? (
              <ul className="list-view">
                {mailboxes.map((mailbox) => (
                  <li key={mailbox.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{mailbox.name}</strong>
                        <p>{mailbox.address}</p>
                        <small>
                          Mode: {mailbox.ingestion_mode} · Active: {mailbox.is_active ? 'Yes' : 'No'}
                        </small>
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => handlePollMailbox(mailbox)}>
                          Poll
                        </button>
                        <button type="button" onClick={() => openMailboxModal(mailbox)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => handleMailboxDelete(mailbox)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No mailboxes configured yet.</p>
            )}
          </section>
        )}

        {activeSubNav === 'rules' && (
          <section className="panel" data-section="rules">
            <div className="panel-header">
              <h2>Parsing rules</h2>
              <button type="button" className="primary" onClick={() => openParserModal()}>
                Add parser
              </button>
            </div>
            {parsingRules.length ? (
              <ul className="list-view">
                {parsingRules.map((rule) => (
                  <li key={rule.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{rule.name}</strong>
                        <p>Priority {rule.priority}</p>
                        <small>Active: {rule.is_active ? 'Yes' : 'No'}</small>
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => openParserModal(rule)}>
                          Edit
                        </button>
                        <button type="button" className="danger" onClick={() => handleParserDelete(rule)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No parsing rules yet.</p>
            )}

            <div className="panel-header" style={{ marginTop: '2rem' }}>
              <h2>Mapping rules</h2>
              <button type="button" className="primary" onClick={() => openMappingModal()}>
                Add mapping
              </button>
            </div>
            {mappingRules.length ? (
              <ul className="list-view">
                {mappingRules.map((rule) => (
                  <li key={rule.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{rule.name}</strong>
                        <p>Resource: {rule.resource_identifier || '—'}</p>
                        <small>Active: {rule.is_active ? 'Yes' : 'No'}</small>
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => openMappingModal(rule)}>
                          Edit
                        </button>
                        <button type="button" className="danger" onClick={() => handleMappingDelete(rule)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No mapping rules yet.</p>
            )}

            <div className="panel-header" style={{ marginTop: '2rem' }}>
              <h2>Test rule</h2>
            </div>
            <form className="sc-form" onSubmit={handleRuleTest}>
              <label className="form-field">
                <span>Sender</span>
                <input
                  value={ruleTestForm.sender}
                  onChange={(event) =>
                    setRuleTestForm((prev) => ({ ...prev, sender: event.target.value }))
                  }
                  placeholder="alerts@example.com"
                />
              </label>
              <label className="form-field">
                <span>Subject</span>
                <input
                  value={ruleTestForm.subject}
                  onChange={(event) =>
                    setRuleTestForm((prev) => ({ ...prev, subject: event.target.value }))
                  }
                  placeholder="ALERT: Router Down"
                />
              </label>
              <label className="form-field">
                <span>Body</span>
                <textarea
                  rows="4"
                  value={ruleTestForm.body}
                  onChange={(event) => setRuleTestForm((prev) => ({ ...prev, body: event.target.value }))}
                  placeholder="Resource: edge-01"
                />
              </label>
              <label className="form-field">
                <span>Headers (JSON)</span>
                <textarea
                  rows="3"
                  value={ruleTestForm.headers}
                  onChange={(event) =>
                    setRuleTestForm((prev) => ({ ...prev, headers: event.target.value }))
                  }
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary" disabled={loading}>
                  Test rule
                </button>
              </div>
            </form>
            {ruleTestResult && (
              <div className="template-preview" style={{ marginTop: '1rem' }}>
                <div className="template-preview-section">
                  <span>Parsed</span>
                  <pre>{JSON.stringify(ruleTestResult.parsed, null, 2)}</pre>
                </div>
                <div className="template-preview-section">
                  <span>Mapped</span>
                  <pre>{JSON.stringify(ruleTestResult.mapped, null, 2)}</pre>
                </div>
              </div>
            )}
          </section>
        )}

        {activeSubNav === 'events' && (
          <section className="panel" data-section="events">
            <div className="panel-header compact">
              <h2>Events</h2>
              <div className="incident-filter-chips">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.id}
                    className={`filter-chip ${eventFilter === filter.id ? 'active' : ''}`}
                    onClick={() => setEventFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-field" style={{ marginBottom: '1rem' }}>
              <span>Search events</span>
              <input
                value={eventSearchInput}
                onChange={(event) => setEventSearchInput(event.target.value)}
                placeholder="Search by resource, alert name, or correlation key"
              />
            </div>
            {filteredEvents.length ? (
              <ul className="list-view">
                {filteredEvents.map((eventItem) => (
                  <li key={eventItem.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{eventItem.alert_name || 'Unnamed alert'}</strong>
                        <p>{eventItem.resource_identifier || 'Unknown resource'}</p>
                        <small>
                          Status: {eventItem.status} · Severity: {eventItem.severity || '—'} ·
                          Last seen: {formatDateTime(eventItem.last_seen_at)}
                        </small>
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => handleTimelineOpen(eventItem)}>
                          Timeline
                        </button>
                        <button type="button" onClick={() => handleReplayEvent(eventItem)}>
                          Replay
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No events matched.</p>
            )}
          </section>
        )}

        {activeSubNav === 'deliveries' && (
          <section className="panel" data-section="deliveries">
            <div className="panel-header compact">
              <h2>Deliveries</h2>
              <div className="incident-filter-chips">
                {DELIVERY_FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.id}
                    className={`filter-chip ${deliveriesFilter === filter.id ? 'active' : ''}`}
                    onClick={() => setDeliveriesFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            {filteredDeliveries.length ? (
              <ul className="list-view">
                {filteredDeliveries.map((delivery) => (
                  <li key={delivery.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{delivery.action}</strong>
                        <p>Status: {delivery.status}</p>
                        <small>HTTP: {delivery.http_status || '—'}</small>
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => handleTimelineOpen({ id: delivery.event })}>
                          Event
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No deliveries yet.</p>
            )}
          </section>
        )}
      </main>

      {showMailboxModal && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>{activeMailbox ? 'Edit mailbox' : 'Add mailbox'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowMailboxModal(false)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <form className="sc-form" onSubmit={handleMailboxSubmit}>
                <label className="form-field">
                  <span>Name</span>
                  <input
                    value={mailboxForm.name}
                    onChange={(event) => setMailboxForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Address</span>
                  <input
                    value={mailboxForm.address}
                    onChange={(event) => setMailboxForm((prev) => ({ ...prev, address: event.target.value }))}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Ingestion mode</span>
                  <select
                    value={mailboxForm.ingestion_mode}
                    onChange={(event) =>
                      setMailboxForm((prev) => ({ ...prev, ingestion_mode: event.target.value }))
                    }
                  >
                    <option value="subscription">Subscription</option>
                    <option value="polling">Polling</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Allowlist domains</span>
                  <textarea
                    rows="2"
                    placeholder="example.com, alerts.vendor.com"
                    value={mailboxForm.allowlist_domains}
                    onChange={(event) =>
                      setMailboxForm((prev) => ({ ...prev, allowlist_domains: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Active</span>
                  <select
                    value={mailboxForm.is_active ? 'yes' : 'no'}
                    onChange={(event) =>
                      setMailboxForm((prev) => ({ ...prev, is_active: event.target.value === 'yes' }))
                    }
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={loading}>
                    Save mailbox
                  </button>
                  <button type="button" className="secondary" onClick={() => setShowMailboxModal(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showParserModal && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>{activeParserRule ? 'Edit parser rule' : 'Add parser rule'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowParserModal(false)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <form className="sc-form" onSubmit={handleParserSubmit}>
                <label className="form-field">
                  <span>Name</span>
                  <input
                    value={parserForm.name}
                    onChange={(event) => setParserForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <input
                    type="number"
                    value={parserForm.priority}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, priority: Number(event.target.value) }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Sender contains</span>
                  <input
                    value={parserForm.sender_contains}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, sender_contains: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Subject contains</span>
                  <input
                    value={parserForm.subject_contains}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, subject_contains: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Body regex</span>
                  <textarea
                    rows="2"
                    value={parserForm.body_regex}
                    onChange={(event) => setParserForm((prev) => ({ ...prev, body_regex: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Resource regex</span>
                  <input
                    value={parserForm.resource_regex}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, resource_regex: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Alert name regex</span>
                  <input
                    value={parserForm.alert_name_regex}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, alert_name_regex: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Severity regex</span>
                  <input
                    value={parserForm.severity_regex}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, severity_regex: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>State regex</span>
                  <input
                    value={parserForm.state_regex}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, state_regex: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Timestamp regex</span>
                  <input
                    value={parserForm.timestamp_regex}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, timestamp_regex: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Severity map (JSON)</span>
                  <textarea
                    rows="3"
                    value={parserForm.severity_map}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, severity_map: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>State map (JSON)</span>
                  <textarea
                    rows="3"
                    value={parserForm.state_map}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, state_map: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Active</span>
                  <select
                    value={parserForm.is_active ? 'yes' : 'no'}
                    onChange={(event) =>
                      setParserForm((prev) => ({ ...prev, is_active: event.target.value === 'yes' }))
                    }
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={loading}>
                    Save parser
                  </button>
                  <button type="button" className="secondary" onClick={() => setShowParserModal(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showMappingModal && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>{activeMappingRule ? 'Edit mapping rule' : 'Add mapping rule'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowMappingModal(false)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <form className="sc-form" onSubmit={handleMappingSubmit}>
                <label className="form-field">
                  <span>Name</span>
                  <input
                    value={mappingForm.name}
                    onChange={(event) => setMappingForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <input
                    type="number"
                    value={mappingForm.priority}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, priority: Number(event.target.value) }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Sender contains</span>
                  <input
                    value={mappingForm.sender_contains}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, sender_contains: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Subject contains</span>
                  <input
                    value={mappingForm.subject_contains}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, subject_contains: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Body regex</span>
                  <textarea
                    rows="2"
                    value={mappingForm.body_regex}
                    onChange={(event) => setMappingForm((prev) => ({ ...prev, body_regex: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Header regex</span>
                  <textarea
                    rows="2"
                    value={mappingForm.header_regex}
                    onChange={(event) => setMappingForm((prev) => ({ ...prev, header_regex: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Resource identifier</span>
                  <input
                    value={mappingForm.resource_identifier}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, resource_identifier: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Alert category</span>
                  <input
                    value={mappingForm.alert_category}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, alert_category: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Severity override</span>
                  <input
                    value={mappingForm.severity_override}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, severity_override: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Alert name override</span>
                  <input
                    value={mappingForm.alert_name_override}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, alert_name_override: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Source system</span>
                  <input
                    value={mappingForm.source_system}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, source_system: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Notes</span>
                  <textarea
                    rows="2"
                    value={mappingForm.notes}
                    onChange={(event) => setMappingForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Active</span>
                  <select
                    value={mappingForm.is_active ? 'yes' : 'no'}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, is_active: event.target.value === 'yes' }))
                    }
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
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

      {timelineEvent && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>Timeline</h3>
              <button type="button" className="modal-close" onClick={() => setTimelineEvent(null)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              {timelineLoading ? (
                <p>Loading timeline...</p>
              ) : (
                <>
                  <div className="incident-details-card">
                    <strong>{timelineEvent.alert_name || 'Alert event'}</strong>
                    <p>{timelineEvent.resource_identifier || 'Unknown resource'}</p>
                    <small>Status: {timelineEvent.status || '—'}</small>
                  </div>
                  <h3>Email history</h3>
                  {timelineData.emails.length ? (
                    <ul className="list-view">
                      {timelineData.emails.map((email) => (
                        <li key={email.id}>
                          <strong>{email.subject || 'No subject'}</strong>
                          <p>{email.sender}</p>
                          <small>{formatDateTime(email.received_at)}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-state">No email history recorded.</p>
                  )}
                  <h3>Delivery attempts</h3>
                  {timelineData.deliveries.length ? (
                    <ul className="list-view">
                      {timelineData.deliveries.map((delivery) => (
                        <li key={delivery.id}>
                          <strong>{delivery.action}</strong>
                          <p>Status: {delivery.status}</p>
                          <small>HTTP: {delivery.http_status || '—'}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-state">No delivery attempts logged.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="toast">{toastMessage}</div>}
      {loading && <div className="backdrop">Working...</div>}

      <AppFooter apiBaseUrl={apiBaseUrl} metaBaseUrl={metaBaseUrl || apiBaseUrl} />
    </div>
  );
}

export default AlertIngestionDashboard;
