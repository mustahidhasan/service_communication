import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import { AUTH_STORAGE_KEY } from '../constants/storage';
import '../App.css';
import '../assets/ServiceCommunications.css';

const REGION_OPTIONS = ['Global', 'India', 'Africa', 'Russia'];

const SUB_NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'teams', label: 'Teams' },
  { id: 'incident', label: 'Create Incident' },
  { id: 'active', label: 'All Incidents' },
];

const INCIDENT_STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

const DIRECTORY_SEARCH_MIN = 2;
const DIRECTORY_SEARCH_DEBOUNCE = 350;

// ✅ NEW: persist incident-selected DLs in localStorage
const DL_STORAGE_KEY = 'scIncidentSelectedDistributionLists';

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

const toArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.results)) {
    return payload.results;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
};

const IST_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;

const pad = (value) => String(value).padStart(2, '0');

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: IST_TIMEZONE,
  }).format(date);
};

const toLocalInputValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const istTimestamp = date.getTime() + IST_OFFSET_MS;
  const istDate = new Date(istTimestamp);
  const year = istDate.getUTCFullYear();
  const month = pad(istDate.getUTCMonth() + 1);
  const day = pad(istDate.getUTCDate());
  const hour = pad(istDate.getUTCHours());
  const minute = pad(istDate.getUTCMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const parseIstDateTimeInput = (value) => {
  if (!value || typeof value !== 'string') return null;
  const [datePart, timePart] = value.split('T');
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split('-').map((part) => parseInt(part, 10));
  const [hour, minute] = timePart.split(':').map((part) => parseInt(part, 10));
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
    return null;
  }
  return { year, month, day, hour, minute };
};

const escapeHtml = (value = '') =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatNotesHtml = (value = '') => {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return '';
  }
  const paragraphs = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  return `<div class="template-notes">${paragraphs}</div>`;
};

const normalizeDateForApi = (value) => {
  const parts = parseIstDateTimeInput(value);
  if (!parts) return null;
  const utcTimestamp =
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - IST_OFFSET_MS;
  return new Date(utcTimestamp).toISOString();
};

const EMAIL_SPLIT_REGEX = /[,\s;]+/;

const parseEmailInput = (value = '') =>
  value
    .split(EMAIL_SPLIT_REGEX)
    .map((email) => email.trim())
    .filter(Boolean);

const formatEmailList = (values = []) => values.join(', ');

const arraysEqual = (first = [], second = []) =>
  first.length === second.length && first.every((value, index) => value === second[index]);

const getDefaultPointOfContact = (auth) => {
  if (!auth?.user) return '';
  const { first_name: firstName, last_name: lastName, email } = auth.user;
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || email || '';
};

const getDefaultPointOfContactEmail = (auth) => {
  if (!auth?.user) return '';
  return auth.user.email || '';
};

const buildDefaultIncidentForm = () => ({
  incNumber: '',
  subject: '',
  incidentType: 'major',
  templateType: 'incident',
  problemDescription: '',
  workaround: '',
  affectedRegions: [],
  nextCommunicationTime: '',
  distributionLists: [],
  impact: '',
  severity: 'P3',
  oneOffRecipients: '',
});

const buildDefaultMessageForm = (auth) => ({
  subject: '',
  body: '',
  templateType: 'incident',
  distributionLists: [],
  extraRecipients: '',
  pointOfContact: getDefaultPointOfContact(auth),
  pointOfContactEmail: getDefaultPointOfContactEmail(auth),
  problemDescription: '',
  workaround: '',
  nextCommunicationTime: '',
});

const defaultTeamForm = {
  name: '',
  description: '',
};

const defaultCloseForm = {
  subject: '',
  body: '',
  distribution_lists: [],
  point_of_contact: '',
  point_of_contact_email: '',
};

function Dashboard({ apiBaseUrl, metaBaseUrl, auth, setAuth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const token = auth?.access;
  const [teams, setTeams] = useState(() => (Array.isArray(auth?.teams) ? auth.teams : []));
  const [selectedTeam, setSelectedTeam] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const storedTeam = window.localStorage.getItem('scSelectedTeam');
        if (storedTeam) {
          return storedTeam;
        }
      } catch (err) {
        // ignore storage issues
      }
    }
    const firstTeamId = auth?.teams?.[0]?.id;
    if (firstTeamId === undefined || firstTeamId === null) return null;
    return firstTeamId;
  });
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [serverTemplatePreview, setServerTemplatePreview] = useState(null);
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState(false);
  const [incidentForm, setIncidentForm] = useState(buildDefaultIncidentForm);
  const [preferredMessageTemplate, setPreferredMessageTemplate] = useState('incident');
  const [messageForm, setMessageForm] = useState(() => ({
    ...buildDefaultMessageForm(auth),
    templateType: 'incident',
  }));
  const [messageFiles, setMessageFiles] = useState([]);
  const [teamForm, setTeamForm] = useState(defaultTeamForm);
  const [closeForm, setCloseForm] = useState(() => ({
    ...defaultCloseForm,
    point_of_contact: getDefaultPointOfContact(auth),
    point_of_contact_email: getDefaultPointOfContactEmail(auth),
  }));
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [summary, setSummary] = useState({ open_incident_count: 0, recent_messages: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [activeSubNav, setActiveSubNav] = useState('overview');
  const [toastMessage, setToastMessage] = useState('');
  const [emailSuccessModalVisible, setEmailSuccessModalVisible] = useState(false);
  const [activeIncidentModal, setActiveIncidentModal] = useState(null);
  const [pendingPanelFromQuery, setPendingPanelFromQuery] = useState(null);
  const [directorySearch, setDirectorySearch] = useState({
    incident: '',
    message: '',
    editor: '',
  });
  const [directoryResults, setDirectoryResults] = useState({
    incident: [],
    message: [],
    editor: [],
  });
  const [directorySearchLoading, setDirectorySearchLoading] = useState({
    incident: false,
    message: false,
    editor: false,
  });
  const [recipientEditorForm, setRecipientEditorForm] = useState({
    distributionLists: [],
    oneOffRecipients: '',
  });
  const [incidentNextDraft, setIncidentNextDraft] = useState('');
  const [messageNextDraft, setMessageNextDraft] = useState('');
  const [forceTeamFromIncident, setForceTeamFromIncident] = useState(false);
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('all');
  const refreshPromiseRef = useRef(null);
  const settingsMenuRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const directorySearchRef = useRef({
    incident: '',
    message: '',
    editor: '',
  });

  const legacyBaseUrl = useMemo(() => {
    if (!apiBaseUrl) return '';
    try {
      const parsed = new URL(apiBaseUrl);
      return `${parsed.protocol}//${parsed.host}`;
    } catch (err) {
      return apiBaseUrl.replace(/\/api\/?$/, '') || apiBaseUrl;
    }
  }, [apiBaseUrl]);

  const profileDisplayName = useMemo(() => {
    const first = (auth?.user?.first_name || '').trim();
    if (first) return first;
    const fallback = (auth?.user?.name || '').trim();
    if (fallback) {
      const [firstWord] = fallback.split(/\s+/);
      if (firstWord) {
        return firstWord;
      }
    }
    return 'Service Comms User';
  }, [auth]);

  const userInitials = useMemo(() => {
    const first = auth?.user?.first_name || '';
    const last = auth?.user?.last_name || '';
    const initials = `${first.slice(0, 1)}${last.slice(0, 1)}`.trim();
    if (initials) return initials.toUpperCase();
    const email = auth?.user?.email || '';
    return email.slice(0, 2).toUpperCase() || 'SC';
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
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const handleSectionNav = useCallback((sectionId) => {
    setActiveSubNav(sectionId);
  }, []);

  const handleStatusFilterChange = useCallback((filterId) => {
    setIncidentStatusFilter(filterId);
  }, []);

  const handleTeamFilterChange = useCallback(
    (event) => {
      const value = event.target.value;
      setSelectedTeam(value || null);
    },
    [setSelectedTeam]
  );

  const handleSetDefaultTemplate = useCallback(
    (templateId) => {
      if (!templateId) return;
      setPreferredMessageTemplate(templateId);
      setMessageForm((prev) => ({ ...prev, templateType: templateId }));
      showToast('Template selected for timeline updates');
    },
    [showToast]
  );

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
      return fetch(`${apiBaseUrl}${path}`, {
        credentials: 'include',
        ...opts,
      });
    },
    [apiBaseUrl, token]
  );

  const refreshAccessToken = useCallback(async () => {
    if (!auth?.refresh) {
      return null;
    }
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = (async () => {
        try {
          const response = await fetch(`${apiBaseUrl}/auth/refresh/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ refresh: auth.refresh }),
          });
          let data = null;
          try {
            data = await response.json();
          } catch (err) {
            // ignore parsing issue, handled below
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
  }, [apiBaseUrl, auth, persistAuth]);

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

  const handleViewUserActivity = useCallback(() => {
    setShowSettingsDropdown(false);
    navigate('/user-activity');
  }, [navigate]);

  const handleLogout = useCallback(async () => {
    setShowSettingsDropdown(false);
    persistAuth(null);
    try {
      const headers = {};
      const csrfToken = readCookie('csrftoken');
      if (csrfToken) {
        headers['X-CSRFToken'] = csrfToken;
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
        window.location.href = data.logout_url;
        return;
      }
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      navigate('/');
    }
  }, [legacyBaseUrl, navigate, persistAuth]);

  // ✅ NEW: restore incident-selected DLs from localStorage on first mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DL_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed) || !parsed.length) return;
      setIncidentForm((prev) => ({ ...prev, distributionLists: parsed }));
    } catch (_) {
      // ignore corrupted storage
    }
  }, []);

  useEffect(() => {
    if (!token) {
      navigate('/');
      return;
    }
    const bootstrap = async () => {
      try {
        setLoading(true);
        const [templateData, teamResult] = await Promise.all([apiRequest('/templates/'), loadTeams()]);
        setTemplates(toArray(templateData));
        const initialTeam =
          (teamResult && Object.prototype.hasOwnProperty.call(teamResult, 'selected')
            ? teamResult.selected
            : null) ?? selectedTeam ?? null;
        await Promise.all([loadIncidents(), loadSummary()]);
        setError('');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const fetchIncidentsForTeam = async () => {
      if (selectedTeam) {
        setSelectedIncident(null);
      }
      try {
        await loadIncidents();
      } catch (err) {
        if (err?.status === 401) {
          return;
        }
        console.error('Failed to load incidents', err);
        setError(err.message || 'Unable to load incidents.');
      }
    };
    fetchIncidentsForTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam]);

  useEffect(() => {
    setIncidentNextDraft(incidentForm.nextCommunicationTime || '');
  }, [incidentForm.nextCommunicationTime]);

  useEffect(() => {
    setMessageNextDraft(messageForm.nextCommunicationTime || '');
  }, [messageForm.nextCommunicationTime]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      if (selectedTeam === null || selectedTeam === undefined) {
        window.localStorage.removeItem('scSelectedTeam');
      } else {
        window.localStorage.setItem('scSelectedTeam', String(selectedTeam));
      }
    } catch (err) {
      // ignore storage issues
    }
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedIncident) {
      setMessages([]);
      return;
    }
    loadMessages(selectedIncident).catch((err) => {
      if (err?.status === 401) {
        return;
      }
      console.error('Failed to load incident messages', err);
      setError(err.message || 'Unable to load incident messages.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIncident]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target)) {
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadTeams = async () => {
    const data = await apiRequest('/teams/');
    const normalized = toArray(data);
    setTeams(normalized);
    let nextTeamSelection = null;
    setSelectedTeam((prevSelected) => {
      if (
        prevSelected !== null &&
        prevSelected !== undefined &&
        normalized.some((team) => team.id === prevSelected)
      ) {
        nextTeamSelection = prevSelected;
        return prevSelected;
      }
      const fallback = normalized.length ? normalized[0].id : null;
      const sanitized = fallback !== null ? fallback : null;
      nextTeamSelection = sanitized;
      return sanitized;
    });
    return { teams: normalized, selected: nextTeamSelection };
  };

  const loadSummary = async () => {
    const data = await apiRequest('/dashboard/summary/');
    setSummary(data);
  };

  const loadIncidents = async () => {
    const data = await apiRequest('/incidents/');
    const list = toArray(data);
    setIncidents(list);
    if (selectedIncident) {
      const stillExists = list.find((incident) => incident.id === selectedIncident);
      if (!stillExists) {
        setSelectedIncident(null);
      }
    }
  };

  const loadMessages = async (incidentId) => {
    const data = await apiRequest(`/messages/?incident=${incidentId}`);
    setMessages(toArray(data));
  };

  const performDirectorySearch = useCallback(
    async (target, query) => {
      directorySearchRef.current[target] = query;
      setDirectorySearchLoading((prev) => ({ ...prev, [target]: true }));
      try {
        const results = await apiRequest(
          `/directory/distribution-lists/?search=${encodeURIComponent(query)}`
        );
        if (directorySearchRef.current[target] !== query) {
          return;
        }
        setDirectoryResults((prev) => ({
          ...prev,
          [target]: Array.isArray(results) ? results : toArray(results),
        }));
      } catch (err) {
        if (directorySearchRef.current[target] === query) {
          setDirectoryResults((prev) => ({ ...prev, [target]: [] }));
          setError(err.message);
        }
      } finally {
        if (directorySearchRef.current[target] === query) {
          setDirectorySearchLoading((prev) => ({ ...prev, [target]: false }));
        }
      }
    },
    [apiRequest]
  );

  useEffect(() => {
    const handles = [];
    Object.entries(directorySearch).forEach(([target, rawQuery]) => {
      const trimmed = (rawQuery || '').trim();
      if (!trimmed || trimmed.length < DIRECTORY_SEARCH_MIN) {
        directorySearchRef.current[target] = trimmed;
        setDirectoryResults((prev) => ({ ...prev, [target]: [] }));
        setDirectorySearchLoading((prev) => ({ ...prev, [target]: false }));
        return;
      }
      const timeout = setTimeout(() => {
        performDirectorySearch(target, trimmed);
      }, DIRECTORY_SEARCH_DEBOUNCE);
      handles.push(timeout);
    });
    return () => handles.forEach(clearTimeout);
  }, [directorySearch, performDirectorySearch]);

  const formatDirectoryEntry = (result) => {
    if (!result) return null;
    const graphIdRaw = result.graph_id ?? result.id ?? result.objectId ?? result.groupId ?? '';
    const emailRaw =
      result.email ?? result.mail ?? result.address ?? result.value ?? result.mailAddress ?? '';
    const graphId = String(graphIdRaw || '').trim();
    const email = String(emailRaw || '').trim();
    if (!graphId || !email) {
      return null;
    }
    const displayName =
      result.display_name ||
      result.name ||
      result.displayName ||
      result.mailNickname ||
      email;
    return {
      graph_id: graphId,
      display_name: displayName,
      email,
    };
  };

  const getDistributionListId = (item) => {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return item.graph_id || '';
  };

  // ✅ UPDATED: persist selected incident DLs in localStorage
  const addDistributionEntryToForm = useCallback(
    (target, entry) => {
      if (!entry) return;

      const applyUpdate = (prev) => {
        const current = Array.isArray(prev.distributionLists) ? prev.distributionLists : [];
        if (current.some((item) => getDistributionListId(item) === entry.graph_id)) {
          return prev;
        }
        const next = [...current, entry];

        if (target === 'incident') {
          try {
            localStorage.setItem(DL_STORAGE_KEY, JSON.stringify(next));
          } catch (_) {}
        }

        return { ...prev, distributionLists: next };
      };

      if (target === 'incident') {
        setIncidentForm(applyUpdate);
      } else if (target === 'editor') {
        setRecipientEditorForm(applyUpdate);
      }
    },
    [setIncidentForm, setRecipientEditorForm]
  );

  // ✅ UPDATED: keep localStorage in sync when removing incident DLs
  const removeDistributionEntryFromForm = useCallback(
    (target, graphId) => {
      const normalized = (graphId || '').trim();
      if (!normalized) return;

      const applyUpdate = (prev) => {
        const current = Array.isArray(prev.distributionLists) ? prev.distributionLists : [];
        const next = current.filter((item) => getDistributionListId(item) !== normalized);

        if (target === 'incident') {
          try {
            localStorage.setItem(DL_STORAGE_KEY, JSON.stringify(next));
          } catch (_) {}
        }

        return { ...prev, distributionLists: next };
      };

      if (target === 'incident') {
        setIncidentForm(applyUpdate);
      } else if (target === 'editor') {
        setRecipientEditorForm(applyUpdate);
      }
    },
    [setIncidentForm, setRecipientEditorForm]
  );

  const handleDirectorySelection = useCallback(
    (target, result) => {
      const entry = formatDirectoryEntry(result);
      if (!entry) {
        setError('Unable to use this distribution list. Missing email address.');
        return;
      }
      addDistributionEntryToForm(target, entry);
      setDirectorySearch((prev) => ({ ...prev, [target]: '' }));
      setDirectoryResults((prev) => ({ ...prev, [target]: [] }));
      showToast('Distribution list added from Microsoft 365');
    },
    [addDistributionEntryToForm, showToast]
  );

  const refreshTemplatePreview = useCallback(
    async (templateId, contextOverride) => {
      if (!templateId) return;
      setServerTemplatePreview(null);
      setTemplatePreviewLoading(true);
      try {
        const preview = await apiRequest(`/templates/${templateId}/preview/`, {
          method: 'POST',
          body: { context: contextOverride },
        });
        setServerTemplatePreview(preview);
      } catch (err) {
        console.error('Failed to load template preview', err);
        setServerTemplatePreview(null);
      } finally {
        setTemplatePreviewLoading(false);
      }
    },
    [apiRequest]
  );

  const filteredIncidents = useMemo(() => {
    let list = Array.isArray(incidents) ? incidents : [];
    if (selectedTeam) {
      list = list.filter((incident) => incident.team === selectedTeam);
    }
    if (incidentStatusFilter === 'open') {
      return list.filter((incident) => (incident.status || '').toLowerCase() !== 'closed');
    }
    if (incidentStatusFilter === 'closed') {
      return list.filter((incident) => (incident.status || '').toLowerCase() === 'closed');
    }
    return list;
  }, [incidents, selectedTeam, incidentStatusFilter]);

  useEffect(() => {
    if (!selectedIncident) return;
    const stillVisible = filteredIncidents.some((incident) => incident.id === selectedIncident);
    if (!stillVisible) {
      setSelectedIncident(null);
    }
  }, [filteredIncidents, selectedIncident]);

  const selectedIncidentDetails = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncident),
    [incidents, selectedIncident]
  );

  const availableIncidentLists = useMemo(
    () =>
      Array.isArray(selectedIncidentDetails?.distribution_lists)
        ? selectedIncidentDetails.distribution_lists
        : [],
    [selectedIncidentDetails]
  );

  const distributionLookup = useMemo(() => {
    const map = new Map();
    availableIncidentLists.forEach((list) => map.set(list.graph_id, list));
    return map;
  }, [availableIncidentLists]);

  const selectedTeamLabel = useMemo(() => {
    if (!selectedTeam) return '';
    const found = (teams || []).find((team) => team.id === selectedTeam);
    return found?.name || '';
  }, [teams, selectedTeam]);

  const incidentTeamLookup = useMemo(() => {
    const map = new Map();
    (incidents || []).forEach((incident) => {
      if (incident.reference_id) {
        map.set(incident.reference_id, incident.team);
      }
    });
    return map;
  }, [incidents]);

  const allOpenIncidentsCount = useMemo(
    () =>
      (incidents || []).filter((incident) => (incident.status || '').toLowerCase() !== 'closed')
        .length,
    [incidents]
  );

  const teamOpenIncidentsCount = useMemo(
    () =>
      filteredIncidents.filter((incident) => (incident.status || '').toLowerCase() !== 'closed')
        .length,
    [filteredIncidents]
  );

  const recentMessagesAll = useMemo(
    () => (Array.isArray(summary?.recent_messages) ? summary.recent_messages : []),
    [summary?.recent_messages]
  );

  const recentMessagesTeam = useMemo(() => {
    if (!selectedTeam) return [];
    return recentMessagesAll.filter(
      (message) => incidentTeamLookup.get(message.incident_reference) === selectedTeam
    );
  }, [recentMessagesAll, incidentTeamLookup, selectedTeam]);

  useEffect(() => {
    if (!error) return undefined;
    const timeout = setTimeout(() => setError(''), 3000);
    return () => clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!emailSuccessModalVisible) return undefined;
    const timeout = setTimeout(() => setEmailSuccessModalVisible(false), 2000);
    return () => clearTimeout(timeout);
  }, [emailSuccessModalVisible]);

  const templateOptions = useMemo(() => templates || [], [templates]);
  const templateLookup = useMemo(() => {
    const map = new Map();
    templateOptions.forEach((template) => {
      if (template?.id) {
        map.set(template.id, template);
      }
    });
    return map;
  }, [templateOptions]);

  const messageTemplateContext = useMemo(() => {
    const incident = selectedIncidentDetails;
    const fallbackProblem =
      messageForm.problemDescription || incident?.problem_description || incident?.summary || '';
    const fallbackWorkaround = messageForm.workaround || incident?.workaround || '';
    const fallbackTitle = incident?.title || incident?.summary || messageForm.subject || '';
    const nextCommunicationValue =
      (messageForm.nextCommunicationTime && normalizeDateForApi(messageForm.nextCommunicationTime)) ||
      incident?.next_communication_time;
    const formattedNextUpdate = nextCommunicationValue ? formatDateTime(nextCommunicationValue) : '';
    const notesHtml = formatNotesHtml(messageForm.body || '');
    return {
      incident_title: fallbackTitle,
      incident_number: incident?.inc_number || incident?.reference_id || '',
      incident_reference: incident?.reference_id || '',
      problem: fallbackProblem,
      workaround: fallbackWorkaround || 'No workaround available.',
      impact: incident?.impact || '',
      severity: incident?.severity || '',
      status: incident?.status || '',
      next_update: formattedNextUpdate,
      poc_name: messageForm.pointOfContact || getDefaultPointOfContact(auth),
      poc_email: messageForm.pointOfContactEmail || getDefaultPointOfContactEmail(auth),
      custom_notes: messageForm.body || '',
      custom_notes_html: notesHtml,
    };
  }, [
    auth,
    selectedIncidentDetails,
    messageForm.body,
    messageForm.pointOfContact,
    messageForm.pointOfContactEmail,
    messageForm.problemDescription,
    messageForm.subject,
    messageForm.nextCommunicationTime,
    messageForm.workaround,
  ]);

  const previousIncidentRef = useRef(null);
  const incidentNextCommunicationRef = useRef(null);
  const messageNextCommunicationRef = useRef(null);
  const lastTemplateAppliedRef = useRef(null);
  const templateContextRef = useRef(messageTemplateContext);
  const defaultExtrasRef = useRef('');

  useEffect(() => {
    if (!templateOptions.length) return;
    const exists = templateOptions.some((template) => template.id === preferredMessageTemplate);
    if (!exists) {
      const fallback = templateOptions[0].id;
      setPreferredMessageTemplate(fallback);
      setMessageForm((prev) => ({ ...prev, templateType: fallback }));
    }
  }, [templateOptions, preferredMessageTemplate]);

  useEffect(() => {
    if (!templateOptions.length) return;
    const exists = templateOptions.some((template) => template.id === preferredMessageTemplate);
    if (!exists) {
      const fallback = templateOptions[0].id;
      setPreferredMessageTemplate(fallback);
      setMessageForm((prev) => ({ ...prev, templateType: fallback }));
    }
  }, [templateOptions, preferredMessageTemplate]);

  const getTemplatePreview = useCallback(
    (templateId) => {
      if (!templateId) return null;
      const template = templateLookup.get(templateId);
      if (!template) return null;
      const applyTokens = (value = '') =>
        value.replace(/\{(\w+)\}/g, (_, token) => messageTemplateContext[token] ?? '');
      return {
        subject: applyTokens(template.subject || ''),
        body: applyTokens(template.body || ''),
        html: template.html_body ? applyTokens(template.html_body) : '',
      };
    },
    [templateLookup, messageTemplateContext]
  );

  const clientTemplatePreview = useMemo(
    () => getTemplatePreview(messageForm.templateType),
    [getTemplatePreview, messageForm.templateType]
  );
  const messageTemplatePreview = serverTemplatePreview || clientTemplatePreview;

  const applyTemplateSubject = useCallback(() => {
    if (!messageTemplatePreview?.subject) return;
    setMessageForm((prev) => ({
      ...prev,
      subject: messageTemplatePreview.subject,
    }));
    lastTemplateAppliedRef.current = messageForm.templateType;
    showToast('Template subject applied');
  }, [messageForm.templateType, messageTemplatePreview, showToast]);

  useEffect(() => {
    if (!messageTemplatePreview) return;
    setMessageForm((prev) => {
      if (prev.subject) {
        return prev;
      }
      lastTemplateAppliedRef.current = prev.templateType;
      return {
        ...prev,
        subject: messageTemplatePreview.subject,
      };
    });
  }, [messageTemplatePreview]);

  useEffect(() => {
    setMessageForm((prev) => ({
      ...prev,
      pointOfContact: prev.pointOfContact || getDefaultPointOfContact(auth),
      pointOfContactEmail: prev.pointOfContactEmail || getDefaultPointOfContactEmail(auth),
    }));
  }, [auth]);

  useEffect(() => {
    setCloseForm((prev) => ({
      ...prev,
      point_of_contact: prev.point_of_contact || getDefaultPointOfContact(auth),
      point_of_contact_email: prev.point_of_contact_email || getDefaultPointOfContactEmail(auth),
    }));
  }, [auth]);

  useEffect(() => {
    if (!selectedIncident) {
      previousIncidentRef.current = null;
      setMessageForm({
        ...buildDefaultMessageForm(auth),
        templateType: preferredMessageTemplate,
      });
      return;
    }
    const details = incidents.find((incident) => incident.id === selectedIncident);
    if (!details || previousIncidentRef.current === details.id) {
      return;
    }
    previousIncidentRef.current = details.id;
    const defaultExtraRecipients = Array.isArray(details.default_extra_recipients)
      ? formatEmailList(details.default_extra_recipients)
      : '';
    setMessageForm((prev) => ({
      ...prev,
      pointOfContact: prev.pointOfContact || getDefaultPointOfContact(auth),
      pointOfContactEmail: prev.pointOfContactEmail || getDefaultPointOfContactEmail(auth),
      problemDescription: details.problem_description || '',
      workaround: details.workaround || '',
      nextCommunicationTime: toLocalInputValue(details.next_communication_time),
      distributionLists: Array.isArray(details.distribution_lists)
        ? details.distribution_lists.map((item) => item.graph_id)
        : [],
      extraRecipients:
        prev.extraRecipients && prev.extraRecipients.trim()
          ? prev.extraRecipients
          : defaultExtraRecipients,
      templateType: prev.templateType || preferredMessageTemplate,
    }));
  }, [selectedIncident, incidents, auth, preferredMessageTemplate]);

  useEffect(() => {
    setActiveIncidentModal(null);
  }, [selectedIncident]);

  useEffect(() => {
    setMessageForm((prev) => {
      const allowedIds = availableIncidentLists.map((list) => list.graph_id);
      const filtered = prev.distributionLists.filter((id) => allowedIds.includes(id));
      let nextLists = filtered;
      if (!filtered.length) {
        const incidentDefaults = availableIncidentLists.map((list) => list.graph_id);
        if (incidentDefaults.length) {
          nextLists = incidentDefaults;
        } else {
          nextLists = [];
        }
      }
      const unchanged =
        nextLists.length === prev.distributionLists.length &&
        nextLists.every((id, idx) => id === prev.distributionLists[idx]);
      if (unchanged) {
        return prev;
      }
      return { ...prev, distributionLists: nextLists };
    });
  }, [availableIncidentLists]);

  useEffect(() => {
    refreshTemplatePreview(messageForm.templateType, templateContextRef.current);
  }, [messageForm.templateType, refreshTemplatePreview]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const incidentParam = params.get('incident');
    const panelParam = params.get('panel');
    if (incidentParam) {
      setSelectedIncident((prev) => (prev === incidentParam ? prev : incidentParam));
      setActiveSubNav('active');
      setForceTeamFromIncident(true);
    }
    if (panelParam === 'timeline' || panelParam === 'close') {
      setPendingPanelFromQuery(panelParam);
    } else {
      setPendingPanelFromQuery(null);
    }
    if (!incidentParam) {
      setForceTeamFromIncident(false);
    }
  }, [location.search]);

  useEffect(() => {
    if (!pendingPanelFromQuery) return;
    if (!selectedIncidentDetails) return;
    setActiveIncidentModal(pendingPanelFromQuery);
    setPendingPanelFromQuery(null);
  }, [pendingPanelFromQuery, selectedIncidentDetails]);

  useEffect(() => {
    templateContextRef.current = messageTemplateContext;
  }, [messageTemplateContext]);

  useEffect(() => {
    if (!selectedIncidentDetails) {
      return;
    }
    const nextDefault = formatEmailList(
      Array.isArray(selectedIncidentDetails.default_extra_recipients)
        ? selectedIncidentDetails.default_extra_recipients
        : []
    );
    if (defaultExtrasRef.current === nextDefault) {
      return;
    }
    defaultExtrasRef.current = nextDefault;
    setMessageForm((prev) => {
      const existing = (prev.extraRecipients || '').trim();
      if (existing && existing !== nextDefault) {
        return prev;
      }
      return { ...prev, extraRecipients: nextDefault };
    });
  }, [selectedIncidentDetails]);

  useEffect(() => {
    if (activeIncidentModal !== 'recipients' || !selectedIncidentDetails) {
      return;
    }
    setRecipientEditorForm({
      distributionLists: Array.isArray(selectedIncidentDetails.distribution_lists)
        ? selectedIncidentDetails.distribution_lists.map((entry) => ({
            graph_id: entry.graph_id,
            display_name: entry.display_name,
            email: entry.email,
          }))
        : [],
      oneOffRecipients: formatEmailList(
        Array.isArray(selectedIncidentDetails.default_extra_recipients)
          ? selectedIncidentDetails.default_extra_recipients
          : []
      ),
    });
    setDirectorySearch((prev) => ({ ...prev, editor: '' }));
  }, [activeIncidentModal, selectedIncidentDetails]);

  const selectedIncidentTeam = selectedIncidentDetails?.team;

  useEffect(() => {
    if (!forceTeamFromIncident) return;
    if (!selectedIncidentTeam) return;
    if (selectedTeam === selectedIncidentTeam) {
      setForceTeamFromIncident(false);
      return;
    }
    setSelectedTeam(selectedIncidentTeam);
  }, [forceTeamFromIncident, selectedIncidentTeam, selectedTeam]);

  const handleMessageDistributionChange = (event) => {
    const values = Array.from(event.target.selectedOptions).map((option) => option.value);
    setMessageForm({ ...messageForm, distributionLists: values });
  };

  const toggleRegion = (region) => {
    setIncidentForm((prev) => {
      const exists = prev.affectedRegions.includes(region);
      const affectedRegions = exists
        ? prev.affectedRegions.filter((item) => item !== region)
        : [...prev.affectedRegions, region];
      return { ...prev, affectedRegions };
    });
  };

  const handleIncidentSubmit = async (event) => {
    event.preventDefault();
    if (!selectedTeam) return;
    if (!incidentForm.incidentType) {
      setError('Type is required.');
      return;
    }
    if (!incidentForm.workaround.trim()) {
      setError('Workaround is required.');
      return;
    }
    if (!incidentForm.affectedRegions.length) {
      setError('Select at least one affected region.');
      return;
    }
    if (!incidentForm.distributionLists.length) {
      setError('Select at least one distribution list.');
      return;
    }
    if (!incidentForm.nextCommunicationTime) {
      if (incidentNextDraft) {
        setError('Confirm the next communication time by pressing OK.');
      } else {
        setError('Next communication time is required.');
      }
      return;
    }
    try {
      setLoading(true);
      setError('');
      await apiRequest('/incidents/', {
        method: 'POST',
        body: {
          team: selectedTeam,
          inc_number: incidentForm.incNumber,
          title: incidentForm.subject,
          incident_type: incidentForm.incidentType,
          summary: incidentForm.problemDescription,
          impact: incidentForm.impact,
          severity: incidentForm.severity,
          template_type: incidentForm.templateType,
          problem_description: incidentForm.problemDescription,
          workaround: incidentForm.workaround,
          affected_regions: incidentForm.affectedRegions,
          next_communication_time: normalizeDateForApi(incidentForm.nextCommunicationTime),
          distribution_lists: incidentForm.distributionLists,
          default_extra_recipients: parseEmailInput(incidentForm.oneOffRecipients),
        },
      });

      // ✅ NEW: clear stored incident DLs after successful incident creation
      try {
        localStorage.removeItem(DL_STORAGE_KEY);
      } catch (_) {}

      setIncidentForm(buildDefaultIncidentForm());
      await loadIncidents();
      await loadSummary();
      showToast('Incident is created');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTeamSubmit = async (event) => {
    event.preventDefault();
    if (!teamForm.name.trim()) {
      setError('Team name is required.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const payload = {
        name: teamForm.name.trim(),
        description: teamForm.description,
      };
      if (editingTeamId) {
        await apiRequest(`/teams/${editingTeamId}/`, { method: 'PATCH', body: payload });
        showToast('Team updated');
      } else {
        const created = await apiRequest('/teams/', { method: 'POST', body: payload });
        if (created?.id) {
          setSelectedTeam(created.id);
        }
        showToast('Team created');
      }
      setTeamForm(defaultTeamForm);
      setEditingTeamId(null);
      await loadTeams();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTeamEdit = (team) => {
    if (!team) return;
    setEditingTeamId(team.id);
    setTeamForm({
      name: team.name || '',
      description: team.description || '',
    });
    setActiveSubNav('teams');
  };

  const handleCancelTeamEdit = () => {
    setEditingTeamId(null);
    setTeamForm(defaultTeamForm);
  };

  const handleTeamDelete = async (teamId) => {
    if (!teamId) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Delete this team and its related incidents?');
      if (!confirmed) {
        return;
      }
    }
    try {
      setLoading(true);
      setError('');
      await apiRequest(`/teams/${teamId}/`, { method: 'DELETE' });
      if (editingTeamId === teamId) {
        setEditingTeamId(null);
        setTeamForm(defaultTeamForm);
      }
      showToast('Team deleted');
      await loadTeams();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMessageSubmit = async (event) => {
    event.preventDefault();
    if (!selectedIncident) return;
    const allowedIds = availableIncidentLists.map((list) => list.graph_id);
    const fallbackLists = availableIncidentLists.map((list) => list.graph_id);
    const chosenListsRaw = messageForm.distributionLists.length
      ? messageForm.distributionLists
      : fallbackLists;
    let chosenLists = chosenListsRaw.filter((id) => allowedIds.includes(id));
    if (!chosenLists.length && allowedIds.length) {
      chosenLists = [allowedIds[0]];
    }
    if (!chosenLists.length) {
      setError('Add a distribution list to this incident before sending a message.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const payload = new FormData();
      payload.append('incident', selectedIncident);
      payload.append('subject', messageForm.subject);
      payload.append('body', messageForm.body);
      payload.append('template_type', messageForm.templateType);
      payload.append('point_of_contact', messageForm.pointOfContact);
      payload.append('point_of_contact_email', messageForm.pointOfContactEmail);
      payload.append('problem_description', messageForm.problemDescription);
      payload.append('workaround', messageForm.workaround);
      const nextComms = normalizeDateForApi(messageForm.nextCommunicationTime);
      if (nextComms) {
        payload.append('next_communication_time', nextComms);
      }
      chosenLists.forEach((listId) => payload.append('distribution_lists', listId));
      if (messageForm.extraRecipients) {
        const recipients = messageForm.extraRecipients
          .split(/[\s,;]+/)
          .map((email) => email.trim())
          .filter(Boolean);
        recipients.forEach((email) => payload.append('extra_recipients', email));
      }
      messageFiles.forEach((file) => payload.append('attachments', file));

      await apiRequest('/messages/', {
        method: 'POST',
        body: payload,
        headers: {},
      });

      const defaultExtrasAfterSend = Array.isArray(selectedIncidentDetails?.default_extra_recipients)
        ? formatEmailList(selectedIncidentDetails.default_extra_recipients)
        : '';
      setMessageForm(() => ({
        ...buildDefaultMessageForm(auth),
        templateType: preferredMessageTemplate,
        problemDescription: selectedIncidentDetails?.problem_description || '',
        workaround: selectedIncidentDetails?.workaround || '',
        nextCommunicationTime: toLocalInputValue(selectedIncidentDetails?.next_communication_time),
        distributionLists: Array.isArray(selectedIncidentDetails?.distribution_lists)
          ? selectedIncidentDetails.distribution_lists.map((entry) => entry.graph_id)
          : [],
        extraRecipients: defaultExtrasAfterSend,
      }));
      setMessageFiles([]);
      await loadMessages(selectedIncident);
      showToast('Email sent');
      setEmailSuccessModalVisible(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRecipientUpdate = async (event) => {
    event.preventDefault();
    if (!selectedIncident) return;
    const recipients = parseEmailInput(recipientEditorForm.oneOffRecipients);
    try {
      setLoading(true);
      setError('');
      await apiRequest(`/incidents/${selectedIncident}/`, {
        method: 'PATCH',
        body: {
          distribution_lists: recipientEditorForm.distributionLists,
          default_extra_recipients: recipients,
        },
      });
      showToast('Recipients updated');
      await loadIncidents();
      closeIncidentModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const clearPanelQuery = useCallback(() => {
    const params = new URLSearchParams(location.search || '');
    const hadPanel = params.has('panel');
    const hadIncident = params.has('incident');
    if (!hadPanel && !hadIncident) {
      return;
    }
    params.delete('panel');
    params.delete('incident');
    const nextSearch = params.toString();
    navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const closeIncidentModal = useCallback(() => {
    setActiveIncidentModal(null);
    setPendingPanelFromQuery(null);
    clearPanelQuery();
  }, [clearPanelQuery]);

  const handleCloseIncident = async (event) => {
    event.preventDefault();
    if (!selectedIncident) return;
    try {
      setLoading(true);
      setError('');
      await apiRequest(`/incidents/${selectedIncident}/close/`, {
        method: 'POST',
        body: {
          final_subject: closeForm.subject,
          final_body: closeForm.body,
          distribution_lists: Array.isArray(closeForm.distribution_lists)
            ? closeForm.distribution_lists
            : [],
          point_of_contact: closeForm.point_of_contact || getDefaultPointOfContact(auth),
          point_of_contact_email:
            closeForm.point_of_contact_email || getDefaultPointOfContactEmail(auth),
          problem_description: selectedIncidentDetails?.problem_description || '',
          workaround: selectedIncidentDetails?.workaround || '',
          next_communication_time: selectedIncidentDetails?.next_communication_time || null,
          template_type: selectedIncidentDetails?.template_type || incidentForm.templateType,
        },
      });
      setCloseForm({
        ...defaultCloseForm,
        point_of_contact: getDefaultPointOfContact(auth),
        point_of_contact_email: getDefaultPointOfContactEmail(auth),
      });
      await Promise.all([loadIncidents(), loadMessages(selectedIncident), loadSummary()]);
      showToast('Final message sent, incident is closed');
      const params = new URLSearchParams(location.search || '');
      const launchedFromClosePanel = params.get('panel') === 'close';
      closeIncidentModal();
      if (launchedFromClosePanel && typeof window !== 'undefined' && window.opener) {
        window.close();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const launchIncidentPanel = (panel) => {
    if (!panel || !selectedIncidentDetails) return;
    setActiveIncidentModal(panel);
    const params = new URLSearchParams(location.search || '');
    params.set('incident', selectedIncidentDetails.id);
    params.set('panel', panel);
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  const scrollToIncidentForm = () => {
    setActiveSubNav('incident');
  };

  const scrollToActiveIncidents = () => {
    setActiveSubNav('active');
  };

  const renderTabContent = () => {
    switch (activeSubNav) {
      case 'overview':
        return (
          <section className="sc-overview" data-tab="overview">
            <div className="summary-grid sc-overview-grid">
              <div className="summary-card">
                <h3>All Incidents</h3>
                <p className="summary-value">{incidents.length}</p>
                <small>Open: {allOpenIncidentsCount}</small>
              </div>
              <div className="summary-card">
                <h3>Team: {selectedTeamLabel || 'Select a team'}</h3>
                {selectedTeam ? (
                  <>
                    <p className="summary-value">{filteredIncidents.length}</p>
                    <small>Open: {teamOpenIncidentsCount}</small>
                  </>
                ) : (
                  <>
                    <p className="summary-value">—</p>
                    <small>Select a team to see details.</small>
                  </>
                )}
              </div>
              <div className="summary-card recent">
                <h3>Recent Messages (All)</h3>
                <ul>
                  {recentMessagesAll.map((item) => (
                    <li key={item.id}>
                      <strong>{item.incident_inc_number || 'INC —'}</strong> — {item.subject}
                    </li>
                  ))}
                  {!recentMessagesAll.length && <li>No recent messages.</li>}
                </ul>
              </div>
              <div className="summary-card recent">
                <h3>Recent Messages (Team)</h3>
                {selectedTeam ? (
                  <ul>
                    {recentMessagesTeam.map((item) => (
                      <li key={`team-${item.id}`}>
                        <strong>{item.incident_inc_number || 'INC —'}</strong> — {item.subject}
                      </li>
                    ))}
                    {!recentMessagesTeam.length && <li>No recent messages for this team.</li>}
                  </ul>
                ) : (
                  <p className="empty-state">Select a team to view messages.</p>
                )}
              </div>
            </div>
            <div className="summary-actions">
              <button type="button" className="sc-action primary" onClick={scrollToIncidentForm}>
                Create New Incident
              </button>
              <button type="button" className="sc-action" onClick={scrollToActiveIncidents}>
                View All Incidents
              </button>
            </div>
          </section>
        );
      case 'teams':
        return (
          <div className="tab-stack">
            <section className="tab-panel">
              <h2>Teams</h2>
              <label className="form-field">
                <span>Select Team</span>
                <select
                  value={selectedTeam || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedTeam(value || null);
                  }}
                >
                  <option value="" disabled>
                    Select a team
                  </option>
                  {Array.isArray(teams) &&
                    teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="template-hints">
                <h4>Templates</h4>
                <p>
                  Template library is available directly inside the Email Timeline so you can
                  preview and select wording without leaving the workflow.
                </p>
              </div>
            </section>
            <section className="tab-panel">
              <h2>{editingTeamId ? 'Edit Team' : 'Create Team'}</h2>
              <form onSubmit={handleTeamSubmit} className="form-grid sc-form">
                <label className="form-field">
                  <span>Team Name</span>
                  <input
                    type="text"
                    placeholder="Operations Squad"
                    value={teamForm.name}
                    onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Description</span>
                  <textarea
                    placeholder="Optional description"
                    value={teamForm.description}
                    onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })}
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={loading}>
                    {editingTeamId ? 'Update Team' : 'Save Team'}
                  </button>
                  {editingTeamId && (
                    <button type="button" className="secondary" onClick={handleCancelTeamEdit}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
              <h3>Your Teams</h3>
              <ul className="list-view">
                {Array.isArray(teams) && teams.length ? (
                  teams.map((team) => (
                    <li key={team.id}>
                      <div className="list-item-header">
                        <strong>{team.name}</strong>
                        {team.can_manage && (
                          <div className="list-actions">
                            <button type="button" onClick={() => handleTeamEdit(team)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleTeamDelete(team.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                      {team.description && <p>{team.description}</p>}
                      <small>
                        Role:{' '}
                        {team.membership_role
                          ? team.membership_role
                              .split('_')
                              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                              .join(' ')
                          : 'Member'}
                      </small>
                    </li>
                  ))
                ) : (
                  <li>No teams available yet.</li>
                )}
              </ul>
            </section>
          </div>
        );
      case 'incident':
        if (!selectedTeam) {
          return (
            <section className="tab-panel">
              <h2>Create Incident</h2>
              <p className="empty-state">Select a team using the filter above to create incidents.</p>
            </section>
          );
        }
        return (
          <section className="tab-panel">
            <h2>Create Incident</h2>
            <form onSubmit={handleIncidentSubmit} className="form-grid sc-form">
              <label className="form-field">
                <span>INC Number</span>
                <input
                  type="text"
                  placeholder="INC123456"
                  value={incidentForm.incNumber}
                  onChange={(e) => setIncidentForm({ ...incidentForm, incNumber: e.target.value })}
                  required
                />
              </label>
              <label className="form-field">
                <span>Subject</span>
                <input
                  type="text"
                  placeholder="Subject line for stakeholders"
                  value={incidentForm.subject}
                  onChange={(e) => setIncidentForm({ ...incidentForm, subject: e.target.value })}
                  required
                />
              </label>
              <label className="form-field">
                <span>Incident Type</span>
                <select
                  value={incidentForm.incidentType}
                  onChange={(e) => setIncidentForm({ ...incidentForm, incidentType: e.target.value })}
                  required
                >
                  <option value="major">Major</option>
                  <option value="critical">Critical</option>
                  <option value="informational">Informational</option>
                </select>
              </label>
              <label className="form-field">
                <span>Problem Description</span>
                <textarea
                  placeholder="Symptoms, scope, timeline"
                  value={incidentForm.problemDescription}
                  onChange={(e) =>
                    setIncidentForm({ ...incidentForm, problemDescription: e.target.value })
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>Workaround / Mitigations</span>
                <textarea
                  placeholder="Include known mitigations"
                  value={incidentForm.workaround}
                  onChange={(e) => setIncidentForm({ ...incidentForm, workaround: e.target.value })}
                  required
                />
              </label>
              <label className="form-field">
                <span>Impact Statement</span>
                <textarea
                  placeholder="Customers, services, regions"
                  value={incidentForm.impact}
                  onChange={(e) => setIncidentForm({ ...incidentForm, impact: e.target.value })}
                />
              </label>
              <div className="checkbox-grid">
                <label>Affected Regions</label>
                <div className="regions">
                  {REGION_OPTIONS.map((region) => {
                    const isChecked = incidentForm.affectedRegions.includes(region);
                    return (
                      <label key={region} className={`chip-control${isChecked ? ' active' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRegion(region)}
                        />
                        <span>{region}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="form-field">
                <span>Next Communication Time (UTC/local)</span>
                <div className="datetime-input">
                  <input
                    type="datetime-local"
                    ref={incidentNextCommunicationRef}
                    value={incidentNextDraft}
                    onChange={(e) => setIncidentNextDraft(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="date-ok-button"
                    onClick={() => {
                      setIncidentForm({ ...incidentForm, nextCommunicationTime: incidentNextDraft });
                      if (incidentNextCommunicationRef.current) {
                        incidentNextCommunicationRef.current.blur();
                      }
                      if (incidentNextDraft) {
                        showToast('Next communication updated');
                      }
                    }}
                  >
                    OK
                  </button>
                </div>
              </label>
              <label className="form-field">
                <span>Templates</span>
                <select
                  value={incidentForm.templateType}
                  onChange={(e) => setIncidentForm({ ...incidentForm, templateType: e.target.value })}
                >
                  {templateOptions.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <div className="field-header">
                  <span>Distribution Lists</span>
                </div>

                <small className="form-hint">
                  Lists sync directly from Microsoft Entra ID. Use the search below to add more.
                </small>

                <div className="directory-inline">
                  <input
                    type="text"
                    placeholder="Search distribution list group name or email eg, service_communication"
                    value={directorySearch.incident}
                    onChange={(e) =>
                      setDirectorySearch((prev) => ({ ...prev, incident: e.target.value }))
                    }
                  />
                  {directorySearchLoading.incident && <small className="form-hint">Searching directory…</small>}
                </div>

                {/* ✅ NEW PLACEMENT: show selected DLs BELOW the search input */}
                <div className="selected-distribution-lists">
                  {Array.isArray(incidentForm.distributionLists) && incidentForm.distributionLists.length ? (
                    <ul className="directory-results inline selected">
                      {incidentForm.distributionLists.map((entry) => {
                        const graphId = getDistributionListId(entry);
                        const displayName =
                          (entry && typeof entry === 'object' && entry.display_name) || graphId;
                        const email = (entry && typeof entry === 'object' && entry.email) || '';
                        return (
                          <li key={graphId || displayName}>
                            <div>
                              <strong>{displayName || 'Distribution list'}</strong>
                              <br />
                              <small>{email || graphId}</small>
                            </div>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => removeDistributionEntryFromForm('incident', graphId)}
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="empty-state">No distribution lists selected.</p>
                  )}
                </div>

                {directorySearch.incident.trim().length >= DIRECTORY_SEARCH_MIN && (
                  <ul className="directory-results inline">
                    {directoryResults.incident.length ? (
                      directoryResults.incident.map((result) => (
                        <li key={result.id}>
                          <div>
                            <strong>{result.name}</strong>
                            <br />
                            <small>{result.mail || result.email}</small>
                            {result.description && <p>{result.description}</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDirectorySelection('incident', result)}
                            disabled={directorySearchLoading.incident}
                          >
                            Add
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="empty-state">No directory matches yet.</li>
                    )}
                  </ul>
                )}
              </label>

              <label className="form-field">
                <span>One-off Recipients</span>
                <textarea
                  placeholder="Comma or newline separated email addresses"
                  value={incidentForm.oneOffRecipients}
                  onChange={(e) =>
                    setIncidentForm({ ...incidentForm, oneOffRecipients: e.target.value })
                  }
                  rows={2}
                />
                <small className="form-hint">
                  Optional recipients saved with the incident and used as defaults for future updates.
                </small>
              </label>

              <button type="submit" className="primary" disabled={loading}>
                Save Incident
              </button>
            </form>
          </section>
        );
      case 'active':
        // unchanged (rest of your component continues)
        return (
          <div className="tab-stack">
            <section className="tab-panel">
              <div className="panel-header compact">
                <h2>All Incidents</h2>
                <div className="incident-filter-chips" role="group" aria-label="Filter incidents by status">
                  {INCIDENT_STATUS_FILTERS.map((filter) => (
                    <button
                      type="button"
                      key={filter.id}
                      className={`filter-chip ${incidentStatusFilter === filter.id ? 'active' : ''}`}
                      onClick={() => handleStatusFilterChange(filter.id)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
              {filteredIncidents.length ? (
                <ul className="incident-list">
                  {filteredIncidents.map((incident) => (
                    <li
                      key={incident.id}
                      className={incident.id === selectedIncident ? 'active' : ''}
                      onClick={() => setSelectedIncident(incident.id)}
                    >
                      <div className="incident-row">
                        <div className="incident-heading">
                          <span className="inc-number-chip">{incident.inc_number || 'INC —'}</span>
                          <span>{incident.title}</span>
                        </div>
                        <span className={`status-pill ${incident.status}`}>{incident.status}</span>
                      </div>
                      <small>{incident.incident_type?.toUpperCase()}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">
                  {selectedTeam ? 'No incidents match the selected filters.' : 'Select a team to view incidents.'}
                </p>
              )}
            </section>

            <section className="tab-panel">
              <h2>Incident Workspace</h2>
              {selectedIncidentDetails ? (
                <>
                  <div className="incident-details-card">
                    <p>
                      <strong>SNOW INC:</strong> {selectedIncidentDetails.inc_number || '—'}
                    </p>
                    <p>
                      <strong>Type:</strong> {selectedIncidentDetails.incident_type}
                    </p>
                    <p>
                      <strong>Problem:</strong> {selectedIncidentDetails.problem_description || '—'}
                    </p>
                    <p>
                      <strong>Workaround:</strong> {selectedIncidentDetails.workaround || '—'}
                    </p>
                    <p>
                      <strong>Affected Regions:</strong>{' '}
                      {Array.isArray(selectedIncidentDetails.affected_regions) &&
                      selectedIncidentDetails.affected_regions.length
                        ? selectedIncidentDetails.affected_regions.join(', ')
                        : '—'}
                    </p>
                    <p>
                      <strong>Next Communication:</strong>{' '}
                      {formatDateTime(selectedIncidentDetails.next_communication_time)}
                    </p>
                  </div>
                  <div className="incident-action-buttons">
                    <button type="button" className="primary" onClick={() => launchIncidentPanel('timeline')}>
                      Open Email Timeline
                    </button>
                    <button
                      type="button"
                      className="tertiary"
                      onClick={() => launchIncidentPanel('close')}
                      disabled={(selectedIncidentDetails.status || '').toLowerCase() === 'closed'}
                    >
                      Close Incident
                    </button>
                  </div>
                  <p className="empty-state">
                    Use the actions above to send an email update or finish the incident workflow.
                  </p>
                </>
              ) : (
                <p className="empty-state">
                  Select an incident from the list above to compose updates and view the timeline.
                </p>
              )}
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  // NOTE: The remainder of your component (timeline modal, close modal, recipients modal, header/nav/footer)
  // stays unchanged from your original code.

  const showTimelineModal = activeIncidentModal === 'timeline' && Boolean(selectedIncidentDetails);
  const showCloseModal = activeIncidentModal === 'close' && Boolean(selectedIncidentDetails);
  const timelineModal = showTimelineModal ? (
    <div className="sc-modal-overlay" role="dialog" aria-modal="true" onClick={closeIncidentModal}>
      <div className="sc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sc-modal-header">
          <h3>Email Timeline</h3>
          <button type="button" className="modal-close" onClick={closeIncidentModal} aria-label="Close timeline">
            ✖
          </button>
        </div>
        <div className="sc-modal-body">
          <div className="incident-details-card">
            <p>
              <strong>SNOW INC:</strong> {selectedIncidentDetails?.inc_number || '—'}
            </p>
            <p>
              <strong>Status:</strong> {selectedIncidentDetails?.status || '—'}
            </p>
            <p>
              <strong>Next Communication:</strong>{' '}
              {formatDateTime(selectedIncidentDetails?.next_communication_time)}
            </p>
          </div>
          <form onSubmit={handleMessageSubmit} className="form-grid sc-form">
            <label className="form-field">
              <span>Template</span>
              <select
                value={messageForm.templateType}
                onChange={(e) => setMessageForm({ ...messageForm, templateType: e.target.value })}
              >
                {templateOptions.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            {messageTemplatePreview && (
              <div className="template-preview">
                <div className="template-preview-header">
                  <div>
                    <strong>Template Preview</strong>
                    <small>Confirm and refresh to render the exact email body.</small>
                  </div>
                  <div className="template-preview-actions">
                    <button type="button" className="secondary" onClick={applyTemplateSubject}>
                      Use template
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        refreshTemplatePreview(messageForm.templateType, templateContextRef.current)
                      }
                      disabled={templatePreviewLoading}
                    >
                      {templatePreviewLoading ? 'Rendering…' : 'Refresh preview'}
                    </button>
                    <button
                      type="button"
                      className={`secondary ${
                        preferredMessageTemplate === messageForm.templateType ? 'active' : ''
                      }`}
                      onClick={() => handleSetDefaultTemplate(messageForm.templateType)}
                    >
                      {preferredMessageTemplate === messageForm.templateType ? 'Default' : 'Set Default'}
                    </button>
                  </div>
                </div>
                <div className="template-preview-body">
                  <p>
                    <strong>Subject</strong> {messageTemplatePreview.subject || '—'}
                  </p>
                  {messageTemplatePreview.html ? (
                    <div
                      className="template-preview-html"
                      dangerouslySetInnerHTML={{ __html: messageTemplatePreview.html }}
                    />
                  ) : (
                    <pre>{messageTemplatePreview.body || '—'}</pre>
                  )}
                </div>
              </div>
            )}
            <label className="form-field">
              <span>Subject</span>
              <input
                type="text"
                placeholder="Subject"
                value={messageForm.subject}
                onChange={(e) => setMessageForm({ ...messageForm, subject: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span>Additional Notes (optional)</span>
              <textarea
                placeholder="Any extra context to append after the template body"
                value={messageForm.body}
                onChange={(e) => setMessageForm({ ...messageForm, body: e.target.value })}
              />
            </label>
            <label className="form-field">
              <div className="field-header">
                <span>Distribution Lists</span>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => launchIncidentPanel('recipients')}
                >
                  Edit recipients
                </button>
              </div>
              <select
                multiple
                value={messageForm.distributionLists}
                onChange={handleMessageDistributionChange}
              >
                {availableIncidentLists.map((list) => (
                  <option key={list.graph_id} value={list.graph_id}>
                    {list.display_name}
                    {list.email ? ` (${list.email})` : ''}
                  </option>
                ))}
              </select>
              {!availableIncidentLists.length && (
                <small className="form-hint">
                  No recipients configured. Use Edit recipients to add distribution lists from Microsoft 365.
                </small>
              )}
            </label>
            <label className="form-field">
              <span>Point of Contact</span>
              <input
                type="text"
                placeholder="Point of contact"
                value={messageForm.pointOfContact}
                onChange={(e) => setMessageForm({ ...messageForm, pointOfContact: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Point of Contact Email</span>
              <input
                type="email"
                placeholder="name@example.com"
                value={messageForm.pointOfContactEmail}
                onChange={(e) =>
                  setMessageForm({ ...messageForm, pointOfContactEmail: e.target.value })
                }
                required
              />
            </label>
            <label className="form-field">
              <span>Override Problem Description</span>
              <textarea
                placeholder="Optional override"
                value={messageForm.problemDescription}
                onChange={(e) =>
                  setMessageForm({ ...messageForm, problemDescription: e.target.value })
                }
              />
            </label>
            <label className="form-field">
              <span>Override Workaround</span>
              <textarea
                placeholder="Optional override"
                value={messageForm.workaround}
                onChange={(e) => setMessageForm({ ...messageForm, workaround: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Override Next Communication</span>
              <div className="datetime-input">
                <input
                  type="datetime-local"
                  ref={messageNextCommunicationRef}
                  value={messageNextDraft}
                  onChange={(e) => setMessageNextDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="date-ok-button"
                  onClick={() => {
                    setMessageForm({ ...messageForm, nextCommunicationTime: messageNextDraft });
                    if (messageNextCommunicationRef.current) {
                      messageNextCommunicationRef.current.blur();
                    }
                    if (messageNextDraft) {
                      showToast('Message next communication updated');
                    }
                  }}
                >
                  OK
                </button>
              </div>
            </label>
            <label className="form-field">
              <span>One-off Recipients</span>
              <textarea
                placeholder="Comma or newline separated emails"
                value={messageForm.extraRecipients}
                onChange={(e) => setMessageForm({ ...messageForm, extraRecipients: e.target.value })}
                rows={2}
              />
            </label>
            <label className="form-field">
              <span>Attachments</span>
              <input type="file" multiple onChange={(e) => setMessageFiles(Array.from(e.target.files))} />
            </label>
            <button type="submit" className="primary" disabled={loading}>
              Send Email
            </button>
          </form>
          <hr />
          <ul className="timeline">
            {messages.map((message) => (
              <li key={message.id}>
                <div className="timeline-header">
                  <strong>{message.subject}</strong>
                  <span>{formatDateTime(message.created_at)}</span>
                </div>
                {message.body_html ? (
                  <div
                    className="timeline-body"
                    dangerouslySetInnerHTML={{ __html: message.body_html }}
                  />
                ) : (
                  <p>{message.body}</p>
                )}
                <div className="timeline-meta">
                  <small>
                    POC: {message.point_of_contact || '—'}
                    {message.point_of_contact_email ? ` (${message.point_of_contact_email})` : ''}
                  </small>
                  <small>Next Communication: {formatDateTime(message.next_communication_time)}</small>
                </div>
                <p>
                  <strong>Problem:</strong> {message.problem_description || '—'}
                </p>
                {message.workaround && (
                  <p>
                    <strong>Workaround:</strong> {message.workaround}
                  </p>
                )}
                <small>
                  Distribution:{' '}
                  {(() => {
                    if (Array.isArray(message.recipients_snapshot) && message.recipients_snapshot.length) {
                      const names = message.recipients_snapshot.map((recipient) => {
                        if (recipient.type === 'one_off') {
                          return recipient.email;
                        }
                        const label = recipient.name || 'Directory list';
                        const email = recipient.email ? ` (${recipient.email})` : '';
                        return `${label}${email}`;
                      });
                      return names.join(', ');
                    }
                    const toLabel = (list) =>
                      list ? `${list.display_name}${list.email ? ` (${list.email})` : ''}` : null;
                    const listNames = [...(message.distribution_lists || [])]
                      .map((id) => toLabel(distributionLookup.get(id)) || 'Directory list')
                      .filter(Boolean);
                    return listNames.length ? listNames.join(', ') : '—';
                  })()}
                </small>
                <br />
                <small>Delivery: {message.delivery_status}</small>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  ) : null;

  const closeModal = showCloseModal ? (
    <div className="sc-modal-overlay" role="dialog" aria-modal="true" onClick={closeIncidentModal}>
      <div className="sc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sc-modal-header">
          <h3>Close Incident</h3>
          <button type="button" className="modal-close" onClick={closeIncidentModal} aria-label="Close dialog">
            ✖
          </button>
        </div>
        <div className="sc-modal-body">
          <form onSubmit={handleCloseIncident} className="form-grid sc-form">
            <label className="form-field">
              <span>Final Subject</span>
              <input
                type="text"
                placeholder="Final subject"
                value={closeForm.subject}
                onChange={(e) => setCloseForm({ ...closeForm, subject: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span>Final Message Body</span>
              <textarea
                placeholder="Final message body"
                value={closeForm.body}
                onChange={(e) => setCloseForm({ ...closeForm, body: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span>Distribution Lists</span>
              <select
                multiple
                value={Array.isArray(closeForm.distribution_lists) ? closeForm.distribution_lists : []}
                onChange={(e) =>
                  setCloseForm({
                    ...closeForm,
                    distribution_lists: Array.from(e.target.selectedOptions).map((option) => option.value),
                  })
                }
              >
                {availableIncidentLists.map((list) => (
                  <option key={list.graph_id} value={list.graph_id}>
                    {list.display_name}
                    {list.email ? ` (${list.email})` : ''}
                  </option>
                ))}
              </select>
              <small className="form-hint">
                Leave empty to use all incident recipients. Select specific lists to limit delivery.
              </small>
            </label>
            <label className="form-field">
              <span>Point of Contact</span>
              <input
                type="text"
                placeholder="Name"
                value={closeForm.point_of_contact}
                onChange={(e) => setCloseForm({ ...closeForm, point_of_contact: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Point of Contact Email</span>
              <input
                type="email"
                placeholder="name@example.com"
                value={closeForm.point_of_contact_email}
                onChange={(e) =>
                  setCloseForm({ ...closeForm, point_of_contact_email: e.target.value })
                }
                required
              />
            </label>
                    <button type="submit" className="primary" disabled={loading}>
                      Close Incident & Notify
                    </button>
                  </form>
        </div>
      </div>
    </div>
  ) : null;

  const showRecipientsModal =
    activeIncidentModal === 'recipients' && Boolean(selectedIncidentDetails);
  const recipientsModal = showRecipientsModal ? (
    <div className="sc-modal-overlay" role="dialog" aria-modal="true" onClick={closeIncidentModal}>
      <div className="sc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sc-modal-header">
          <h3>Edit Recipients</h3>
          <button type="button" className="modal-close" onClick={closeIncidentModal} aria-label="Close dialog">
            ✖
          </button>
        </div>
        <div className="sc-modal-body">
          <form onSubmit={handleRecipientUpdate} className="form-grid sc-form">
            <label className="form-field">
              <span>Distribution Lists</span>
              <div className="selected-distribution-lists">
                {Array.isArray(recipientEditorForm.distributionLists) &&
                recipientEditorForm.distributionLists.length ? (
                  <ul className="directory-results inline">
                    {recipientEditorForm.distributionLists.map((entry) => {
                      const graphId = getDistributionListId(entry);
                      const displayName =
                        (entry && typeof entry === 'object' && entry.display_name) || graphId;
                      const email =
                        (entry && typeof entry === 'object' && entry.email) || '';
                      return (
                        <li key={graphId || displayName}>
                          <div>
                            <strong>{displayName || 'Distribution list'}</strong>
                            <br />
                            <small>{email || graphId}</small>
                          </div>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => removeDistributionEntryFromForm('editor', graphId)}
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="empty-state">No distribution lists selected.</p>
                )}
              </div>
            </label>
            <div className="directory-inline">
              <input
                type="text"
                placeholder="Search Microsoft 365 distribution lists"
                value={directorySearch.editor}
                onChange={(e) =>
                  setDirectorySearch((prev) => ({ ...prev, editor: e.target.value }))
                }
              />
            </div>
            {directorySearch.editor.trim().length >= DIRECTORY_SEARCH_MIN && (
              <ul className="directory-results inline">
                {directoryResults.editor.length ? (
                  directoryResults.editor.map((result) => (
                    <li key={result.id}>
                      <div>
                        <strong>{result.name}</strong>
                        <br />
                        <small>{result.mail || result.email}</small>
                        {result.description && <p>{result.description}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDirectorySelection('editor', result)}
                        disabled={directorySearchLoading.editor}
                      >
                        Add
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="empty-state">No directory matches yet.</li>
                )}
              </ul>
            )}
            <label className="form-field">
              <span>One-off Recipients</span>
              <textarea
                placeholder="Comma or newline separated emails"
                value={recipientEditorForm.oneOffRecipients}
                onChange={(e) =>
                  setRecipientEditorForm((prev) => ({ ...prev, oneOffRecipients: e.target.value }))
                }
              />
            </label>
            <button type="submit" className="primary" disabled={loading}>
              Save recipients
            </button>
          </form>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="app-shell service-communications">
      <header className="app-header sc-header">
        <div className="sc-branding">
          <img src="logo_left.png" alt="Service Communications" className="sc-logo" />
          <div>
            <h1>Service Communications</h1>
            <p>Structured incident and announcement workflows</p>
          </div>
        </div>
        <div className="header-actions sc-header-actions">
          <img
            src="logo_right.png"
            alt="Operations Partner"
            className="sc-logo sc-logo-compact"
          />
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
                <button type="button" onClick={handleViewUserActivity}>
                  👥 User Activity
                </button>
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
            onClick={() => handleSectionNav(section.id)}
          >
            {section.label}
          </button>
        ))}
        <div className="team-filter-control">
          <label htmlFor="team-filter-select">Team</label>
          <select
            id="team-filter-select"
            value={selectedTeam || ''}
            onChange={handleTeamFilterChange}
          >
            <option value="">Select a team</option>
            {Array.isArray(teams) &&
              teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
        </div>
      </nav>

      {error && <div className="alert">{error}</div>}

      <div className="tab-content">{renderTabContent()}</div>

      {timelineModal}
      {closeModal}
      {recipientsModal}

      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
      {emailSuccessModalVisible && (
        <div
          className="sc-modal-overlay"
          role="alertdialog"
          aria-modal="true"
          onClick={() => setEmailSuccessModalVisible(false)}
        >
          <div
            className="sc-modal success-modal"
            role="document"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sc-modal-header">
              <button
                type="button"
                className="modal-close"
                onClick={() => setEmailSuccessModalVisible(false)}
                aria-label="Close notification"
              >
                ✖
              </button>
            </div>
            <div className="sc-modal-body success-body">
              <div className="success-icon">✅</div>
              <h3>Email Sent Successfully</h3>
              <p>Your update has been shared with the selected distribution lists.</p>
              <button
                type="button"
                className="primary"
                onClick={() => setEmailSuccessModalVisible(false)}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <AppFooter apiBaseUrl={apiBaseUrl} metaBaseUrl={metaBaseUrl || apiBaseUrl} />

      {loading && <div className="backdrop">Working...</div>}
    </div>
  );
}

export default Dashboard;
