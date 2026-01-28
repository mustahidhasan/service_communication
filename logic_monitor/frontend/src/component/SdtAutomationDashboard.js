import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import { AUTH_STORAGE_KEY } from '../constants/storage';
import '../assets/LogicMonitor.css';

const SUB_NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'mailboxes', label: 'Mailboxes' },
  { id: 'rules', label: 'Mapping Rules' },
  { id: 'emails', label: 'Emails' },
  { id: 'sdt', label: 'SDT Activity' },
];

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'needs_mapping', label: 'Needs mapping' },
  { id: 'failed', label: 'Failed' },
  { id: 'sdt_created', label: 'Success' },
];

const SDT_FILTERS = [
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

const normalizeTargetType = (value) => {
  if (!value) return 'device';
  const normalized = value.toLowerCase();
  if (['device_group', 'group', 'site', 'devicegroup'].includes(normalized)) {
    return 'device_group';
  }
  if (normalized === 'service') {
    return 'service';
  }
  return 'device';
};

const buildMailboxForm = (mailbox) => ({
  name: mailbox?.name || '',
  address: mailbox?.address || '',
  ingestion_mode: mailbox?.ingestion_mode || 'poll',
  polling_interval_seconds: mailbox?.polling_interval_seconds || '',
  allowlist_domains: Array.isArray(mailbox?.allowlist_domains)
    ? mailbox.allowlist_domains.join(', ')
    : '',
  is_active: mailbox?.is_active ?? true,
});

const buildRuleForm = (rule) => ({
  name: rule?.name || '',
  priority: rule?.priority ?? 100,
  sender_contains: rule?.sender_contains || '',
  subject_contains: rule?.subject_contains || '',
  body_regex: rule?.body_regex || '',
  keyword_list: Array.isArray(rule?.keyword_list) ? rule.keyword_list.join(', ') : '',
  target_type: normalizeTargetType(rule?.target_type),
  target_identifiers: Array.isArray(rule?.target_identifiers)
    ? rule.target_identifiers.join(', ')
    : '',
  notes: rule?.notes || '',
  is_active: rule?.is_active ?? true,
});

const buildManualMappingForm = (mappingResult) => ({
  target_type: normalizeTargetType(mappingResult?.targets?.[0]?.type),
  targets: Array.isArray(mappingResult?.targets)
    ? mappingResult.targets.map((entry) => entry.identifier).join(', ')
    : '',
});

function SdtAutomationDashboard({ apiBaseUrl, metaBaseUrl, auth, setAuth }) {
  const navigate = useNavigate();
  const refreshPromiseRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const settingsMenuRef = useRef(null);

  const [activeSubNav, setActiveSubNav] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const [mailboxes, setMailboxes] = useState([]);
  const [rules, setRules] = useState([]);
  const [emails, setEmails] = useState([]);
  const [sdtRequests, setSdtRequests] = useState([]);

  const [emailFilter, setEmailFilter] = useState('all');
  const [emailSearch, setEmailSearch] = useState('');
  const [emailSearchInput, setEmailSearchInput] = useState('');
  const [sdtFilter, setSdtFilter] = useState('all');

  const [showMailboxModal, setShowMailboxModal] = useState(false);
  const [activeMailbox, setActiveMailbox] = useState(null);
  const [mailboxForm, setMailboxForm] = useState(buildMailboxForm());

  const [showRuleModal, setShowRuleModal] = useState(false);
  const [activeRule, setActiveRule] = useState(null);
  const [ruleForm, setRuleForm] = useState(buildRuleForm());

  const [ruleTestForm, setRuleTestForm] = useState({
    sender: '',
    subject: '',
    body: '',
  });
  const [ruleTestResult, setRuleTestResult] = useState(null);

  const [selectedEmail, setSelectedEmail] = useState(null);
  const [emailDetail, setEmailDetail] = useState(null);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [mappingForm, setMappingForm] = useState(buildManualMappingForm());

  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);

  const token = auth?.access;
  const apiBase = useMemo(() => normalizeBase(apiBaseUrl), [apiBaseUrl]);
  const rootApiBase = useMemo(
    () => normalizeBase(metaBaseUrl || apiBaseUrl),
    [metaBaseUrl, apiBaseUrl]
  );
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

  const fetchWithRootBase = useCallback(
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
      return fetch(`${rootApiBase}${path}`, {
        credentials: 'include',
        ...opts,
      });
    },
    [rootApiBase, token]
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

  const rootApiRequest = useCallback(
    async (path, options = {}) => {
      const response = await fetchWithRootBase(path, options);
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
        if (error.status === 401) {
          handleSessionExpired();
        }
        throw error;
      }
      return data;
    },
    [fetchWithRootBase, handleSessionExpired]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [mailboxData, ruleData, emailData, sdtData] = await Promise.all([
        apiRequest('/mailboxes/'),
        apiRequest('/rules/'),
        apiRequest('/emails/'),
        apiRequest('/sdt-requests/'),
      ]);
      setMailboxes(Array.isArray(mailboxData?.results) ? mailboxData.results : mailboxData || []);
      setRules(Array.isArray(ruleData?.results) ? ruleData.results : ruleData || []);
      setEmails(Array.isArray(emailData?.results) ? emailData.results : emailData || []);
      setSdtRequests(Array.isArray(sdtData?.results) ? sdtData.results : sdtData || []);
    } catch (err) {
      setError(err.message || 'Failed to load SDT automation data.');
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
      setEmailSearch(emailSearchInput.trim());
    }, 350);
    return () => clearTimeout(handler);
  }, [emailSearchInput]);

  const filteredEmails = useMemo(() => {
    let filtered = emails;
    if (emailFilter !== 'all') {
      filtered = filtered.filter((entry) => entry.status === emailFilter);
    }
    if (emailSearch) {
      const lower = emailSearch.toLowerCase();
      filtered = filtered.filter((entry) => {
        return (
          entry.subject?.toLowerCase().includes(lower) ||
          entry.sender?.toLowerCase().includes(lower) ||
          entry.provider_message_id?.toLowerCase().includes(lower)
        );
      });
    }
    return filtered;
  }, [emails, emailFilter, emailSearch]);

  const filteredSdtRequests = useMemo(() => {
    if (sdtFilter === 'all') {
      return sdtRequests;
    }
    return sdtRequests.filter((entry) => entry.lm_status === sdtFilter);
  }, [sdtRequests, sdtFilter]);

  const summaryCounts = useMemo(() => {
    return {
      total: emails.length,
      needsMapping: emails.filter((entry) => entry.status === 'needs_mapping').length,
      failed: emails.filter((entry) => entry.status === 'failed').length,
      success: emails.filter((entry) => entry.status === 'sdt_created').length,
    };
  }, [emails]);

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

  const openRuleModal = useCallback((rule = null) => {
    setActiveRule(rule);
    setRuleForm(buildRuleForm(rule));
    setShowRuleModal(true);
  }, []);

  const openMappingModal = useCallback((email) => {
    setEmailDetail(email);
    setMappingForm(buildManualMappingForm(email?.mapping_result));
    setShowMappingModal(true);
  }, []);

  const handleMailboxSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
        const payload = {
          ...mailboxForm,
          polling_interval_seconds: mailboxForm.polling_interval_seconds
            ? Number(mailboxForm.polling_interval_seconds)
            : null,
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
        showToast('Mailbox polled');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to poll mailbox.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const handleRuleSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setLoading(true);
      setError('');
      try {
        const payload = {
          ...ruleForm,
          priority: Number(ruleForm.priority || 100),
          keyword_list: ruleForm.keyword_list
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          target_identifiers: ruleForm.target_identifiers
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        };
        if (activeRule?.id) {
          await apiRequest(`/rules/${activeRule.id}/`, {
            method: 'PUT',
            body: payload,
          });
          showToast('Rule updated');
        } else {
          await apiRequest('/rules/', { method: 'POST', body: payload });
          showToast('Rule created');
        }
        setShowRuleModal(false);
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to save rule.');
      } finally {
        setLoading(false);
      }
    },
    [activeRule, apiRequest, loadData, ruleForm, showToast]
  );

  const handleRuleDelete = useCallback(
    async (rule) => {
      if (!rule?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/rules/${rule.id}/`, { method: 'DELETE' });
        showToast('Rule removed');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to delete rule.');
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
        const data = await apiRequest('/parser/test/', {
          method: 'POST',
          body: ruleTestForm,
        });
        setRuleTestResult(data);
      } catch (err) {
        setError(err.message || 'Unable to test parser.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, ruleTestForm]
  );

  const handleEmailSelect = useCallback(
    async (email) => {
      if (!email?.id) return;
      setSelectedEmail(email);
      setEmailDetail(null);
      setLoading(true);
      setError('');
      try {
        const detail = await apiRequest(`/emails/${email.id}/`);
        setEmailDetail(detail);
      } catch (err) {
        setError(err.message || 'Unable to load email detail.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest]
  );

  const handleReplay = useCallback(
    async (email) => {
      if (!email?.id) return;
      setLoading(true);
      setError('');
      try {
        await rootApiRequest(`/emails/${email.id}/replay/`, { method: 'POST' });
        showToast('Replay queued');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to replay email.');
      } finally {
        setLoading(false);
      }
    },
    [loadData, rootApiRequest, showToast]
  );

  const handleIgnore = useCallback(
    async (email) => {
      if (!email?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/emails/${email.id}/ignore/`, { method: 'POST' });
        showToast('Email ignored');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to ignore email.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadData, showToast]
  );

  const handleMappingUpdate = useCallback(
    async (event) => {
      event.preventDefault();
      if (!emailDetail?.id) return;
      setLoading(true);
      setError('');
      try {
        await apiRequest(`/emails/${emailDetail.id}/mapping/`, {
          method: 'PATCH',
          body: {
            target_type: mappingForm.target_type,
            targets: mappingForm.targets,
          },
        });
        setShowMappingModal(false);
        showToast('Mapping updated');
        await loadData();
      } catch (err) {
        setError(err.message || 'Unable to update mapping.');
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, emailDetail?.id, loadData, mappingForm, showToast]
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
            <h1>LogicMonitor SDT Automation</h1>
            <p>Automated scheduled downtime from vendor maintenance emails.</p>
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
              <h2>Automation health</h2>
              <button type="button" className="secondary" onClick={loadData} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <p>Total emails</p>
                <h3 className="summary-value">{summaryCounts.total}</h3>
              </div>
              <div className="summary-card">
                <p>Needs mapping</p>
                <h3 className="summary-value">{summaryCounts.needsMapping}</h3>
              </div>
              <div className="summary-card">
                <p>Failed</p>
                <h3 className="summary-value">{summaryCounts.failed}</h3>
              </div>
              <div className="summary-card">
                <p>SDT created</p>
                <h3 className="summary-value">{summaryCounts.success}</h3>
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
                        <button type="button" className="danger" onClick={() => handleMailboxDelete(mailbox)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No mailboxes configured.</p>
            )}
          </section>
        )}

        {activeSubNav === 'rules' && (
          <section className="panel" data-section="rules">
            <div className="panel-header">
              <h2>Mapping rules</h2>
              <button type="button" className="primary" onClick={() => openRuleModal()}>
                Add rule
              </button>
            </div>
            {rules.length ? (
              <ul className="list-view">
                {rules.map((rule) => (
                  <li key={rule.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{rule.name}</strong>
                        <p>
                          Targets:{' '}
                          {(Array.isArray(rule.target_identifiers)
                            ? rule.target_identifiers
                            : rule.target_identifiers
                            ? [rule.target_identifiers]
                            : []
                          ).join(', ') || '—'}
                        </p>
                        <small>Active: {rule.is_active ? 'Yes' : 'No'}</small>
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => openRuleModal(rule)}>
                          Edit
                        </button>
                        <button type="button" className="danger" onClick={() => handleRuleDelete(rule)}>
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
              <h2>Parser test</h2>
            </div>
            <form className="sc-form" onSubmit={handleRuleTest}>
              <label className="form-field">
                <span>Sender</span>
                <input
                  value={ruleTestForm.sender}
                  onChange={(event) =>
                    setRuleTestForm((prev) => ({ ...prev, sender: event.target.value }))
                  }
                  placeholder="vendor@example.com"
                />
              </label>
              <label className="form-field">
                <span>Subject</span>
                <input
                  value={ruleTestForm.subject}
                  onChange={(event) =>
                    setRuleTestForm((prev) => ({ ...prev, subject: event.target.value }))
                  }
                  placeholder="Planned maintenance window"
                />
              </label>
              <label className="form-field">
                <span>Body</span>
                <textarea
                  rows="4"
                  value={ruleTestForm.body}
                  onChange={(event) => setRuleTestForm((prev) => ({ ...prev, body: event.target.value }))}
                  placeholder="Start: 2024-07-19 22:00 UTC"
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary" disabled={loading}>
                  Test parser
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

        {activeSubNav === 'emails' && (
          <section className="panel" data-section="emails">
            <div className="panel-header compact">
              <h2>Emails</h2>
              <div className="incident-filter-chips">
                {STATUS_FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.id}
                    className={`filter-chip ${emailFilter === filter.id ? 'active' : ''}`}
                    onClick={() => setEmailFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-field" style={{ marginBottom: '1rem' }}>
              <span>Search emails</span>
              <input
                value={emailSearchInput}
                onChange={(event) => setEmailSearchInput(event.target.value)}
                placeholder="Search by subject, sender, or message id"
              />
            </div>
            {filteredEmails.length ? (
              <ul className="list-view">
                {filteredEmails.map((entry) => (
                  <li key={entry.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>{entry.subject || 'Maintenance notice'}</strong>
                        <p>{entry.sender || 'Unknown sender'}</p>
                        <small>
                          Status: {entry.status} · Received: {formatDateTime(entry.received_at)}
                        </small>
                      </div>
                      <div className="list-actions">
                        <button type="button" onClick={() => handleEmailSelect(entry)}>
                          Details
                        </button>
                        <button type="button" onClick={() => handleReplay(entry)}>
                          Replay
                        </button>
                        <button type="button" className="danger" onClick={() => handleIgnore(entry)}>
                          Ignore
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No emails matched.</p>
            )}
          </section>
        )}

        {activeSubNav === 'sdt' && (
          <section className="panel" data-section="sdt">
            <div className="panel-header compact">
              <h2>SDT activity</h2>
              <div className="incident-filter-chips">
                {SDT_FILTERS.map((filter) => (
                  <button
                    type="button"
                    key={filter.id}
                    className={`filter-chip ${sdtFilter === filter.id ? 'active' : ''}`}
                    onClick={() => setSdtFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            {filteredSdtRequests.length ? (
              <ul className="list-view">
                {filteredSdtRequests.map((entry) => (
                  <li key={entry.id}>
                    <div className="list-item-header">
                      <div>
                        <strong>SDT {entry.lm_status}</strong>
                        <p>Email ID: {entry.email || '—'}</p>
                        <small>
                          Created: {formatDateTime(entry.created_at)} · SDT ID: {entry.lm_sdt_id || '—'}
                        </small>
                        {entry.lm_error && <small>Error: {entry.lm_error}</small>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No SDT requests yet.</p>
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
                    onChange={(event) =>
                      setMailboxForm((prev) => ({ ...prev, address: event.target.value }))
                    }
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
                    <option value="poll">Polling</option>
                    <option value="webhook">Webhook</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Polling interval (seconds)</span>
                  <input
                    value={mailboxForm.polling_interval_seconds}
                    onChange={(event) =>
                      setMailboxForm((prev) => ({
                        ...prev,
                        polling_interval_seconds: event.target.value,
                      }))
                    }
                    placeholder="300"
                  />
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

      {showRuleModal && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>{activeRule ? 'Edit rule' : 'Add rule'}</h3>
              <button type="button" className="modal-close" onClick={() => setShowRuleModal(false)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <form className="sc-form" onSubmit={handleRuleSubmit}>
                <label className="form-field">
                  <span>Name</span>
                  <input
                    value={ruleForm.name}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <input
                    type="number"
                    value={ruleForm.priority}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, priority: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Sender contains</span>
                  <input
                    value={ruleForm.sender_contains}
                    onChange={(event) =>
                      setRuleForm((prev) => ({ ...prev, sender_contains: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Subject contains</span>
                  <input
                    value={ruleForm.subject_contains}
                    onChange={(event) =>
                      setRuleForm((prev) => ({ ...prev, subject_contains: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Body regex</span>
                  <input
                    value={ruleForm.body_regex}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, body_regex: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Keywords</span>
                  <input
                    value={ruleForm.keyword_list}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, keyword_list: event.target.value }))}
                    placeholder="NYC, DC1"
                  />
                </label>
                <label className="form-field">
                  <span>Target type</span>
                  <select
                    value={ruleForm.target_type}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, target_type: event.target.value }))}
                  >
                    <option value="device">Device</option>
                    <option value="device_group">Device group</option>
                    <option value="service">Service</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Target identifiers</span>
                  <textarea
                    rows="2"
                    value={ruleForm.target_identifiers}
                    onChange={(event) =>
                      setRuleForm((prev) => ({ ...prev, target_identifiers: event.target.value }))
                    }
                  />
                </label>
                <label className="form-field">
                  <span>Notes</span>
                  <textarea
                    rows="2"
                    value={ruleForm.notes}
                    onChange={(event) => setRuleForm((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>Active</span>
                  <select
                    value={ruleForm.is_active ? 'yes' : 'no'}
                    onChange={(event) =>
                      setRuleForm((prev) => ({ ...prev, is_active: event.target.value === 'yes' }))
                    }
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={loading}>
                    Save rule
                  </button>
                  <button type="button" className="secondary" onClick={() => setShowRuleModal(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {selectedEmail && emailDetail && (
        <div className="sc-modal-overlay">
          <div className="sc-modal">
            <div className="sc-modal-header">
              <h3>Email detail</h3>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setSelectedEmail(null);
                  setEmailDetail(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <div className="incident-details-card">
                <h4>{emailDetail.subject || 'Maintenance notice'}</h4>
                <p>
                  Sender: {emailDetail.sender || '—'} · Received: {formatDateTime(emailDetail.received_at)}
                </p>
                {emailDetail.recipients?.length ? (
                  <p>Recipients: {emailDetail.recipients.join(', ')}</p>
                ) : null}
                <p>Status: {emailDetail.status}</p>
                {emailDetail.status_detail && <p>Status detail: {emailDetail.status_detail}</p>}
                <div className="template-preview" style={{ marginTop: '1rem' }}>
                  <div className="template-preview-section">
                    <span>Parsed window</span>
                    <pre>
                      {JSON.stringify(
                        {
                          start_at: emailDetail.parse_result?.start_at,
                          end_at: emailDetail.parse_result?.end_at,
                          timezone: emailDetail.parse_result?.timezone,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                  <div className="template-preview-section">
                    <span>Mapping targets</span>
                    <pre>
                      {JSON.stringify(
                        {
                          targets: emailDetail.mapping_result?.targets,
                          matched_rules: emailDetail.mapping_result?.matched_rules,
                          mapping_status: emailDetail.mapping_result?.mapping_status,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                  <div className="template-preview-section">
                    <span>SDT status</span>
                    <pre>
                      {JSON.stringify(
                        (emailDetail.sdt_requests || []).map((entry) => ({
                          status: entry.lm_status,
                          lm_sdt_id: entry.lm_sdt_id,
                          error: entry.lm_error,
                        })),
                        null,
                        2
                      )}
                    </pre>
                  </div>
                  <div className="template-preview-section">
                    <span>Raw email</span>
                    <pre>
                      {JSON.stringify(
                        {
                          subject: emailDetail.subject,
                          sender: emailDetail.sender,
                          recipients: emailDetail.recipients,
                          body_text: emailDetail.body_text,
                          body_html: emailDetail.body_html,
                          headers: emailDetail.headers,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
                <div className="incident-action-buttons">
                  <button type="button" className="primary" onClick={() => handleReplay(emailDetail)}>
                    Replay
                  </button>
                  <button type="button" onClick={() => openMappingModal(emailDetail)}>
                    Update mapping
                  </button>
                  <button type="button" className="danger" onClick={() => handleIgnore(emailDetail)}>
                    Ignore
                  </button>
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
              <h3>Manual mapping</h3>
              <button type="button" className="modal-close" onClick={() => setShowMappingModal(false)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <form className="sc-form" onSubmit={handleMappingUpdate}>
                <label className="form-field">
                  <span>Target type</span>
                  <select
                    value={mappingForm.target_type}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, target_type: event.target.value }))
                    }
                  >
                    <option value="device">Device</option>
                    <option value="device_group">Device group</option>
                    <option value="service">Service</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Target identifiers (comma separated)</span>
                  <textarea
                    rows="2"
                    value={mappingForm.targets}
                    onChange={(event) =>
                      setMappingForm((prev) => ({ ...prev, targets: event.target.value }))
                    }
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

      {loading && (
        <div className="backdrop">
          <div>Loading…</div>
        </div>
      )}

      {toastMessage && <div className="toast">{toastMessage}</div>}

      <AppFooter apiBaseUrl={apiBaseUrl} metaBaseUrl={metaBaseUrl || apiBaseUrl} />
    </div>
  );
}

export default SdtAutomationDashboard;
