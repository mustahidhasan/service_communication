import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppFooter from './AppFooter';
import '../App.css';
import '../assets/ServiceCommunications.css';

const REGION_OPTIONS = ['Global', 'India', 'Africa', 'Russia'];

const SUB_NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'teams', label: 'Teams' },
  { id: 'incident', label: 'Create Incident' },
  { id: 'active', label: 'All Incidents' },
  { id: 'lists', label: 'Distribution Lists' },
];

const INCIDENT_STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
];

const readCookie = (name) => {
  if (!document?.cookie) return null;
  return document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')
    ?.slice(1)
    ?.join('=') || null;
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

const normalizeDateForApi = (value) => {
  const parts = parseIstDateTimeInput(value);
  if (!parts) return null;
  const utcTimestamp =
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - IST_OFFSET_MS;
  return new Date(utcTimestamp).toISOString();
};

const getDefaultPointOfContact = (auth) => {
  if (!auth?.user) return '';
  const { first_name: firstName, last_name: lastName, email } = auth.user;
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || email || '';
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
});

const buildDefaultMessageForm = (auth) => ({
  subject: '',
  body: '',
  templateType: 'incident',
  distributionLists: [],
  extraRecipients: '',
  pointOfContact: getDefaultPointOfContact(auth),
  problemDescription: '',
  workaround: '',
  nextCommunicationTime: '',
});

const defaultListForm = {
  name: '',
  description: '',
  emails: '',
  scope: 'team',
};

const defaultTeamForm = {
  name: '',
  description: '',
};

const defaultCloseForm = {
  subject: '',
  body: '',
  distribution_list: '',
};

function Dashboard({ apiBaseUrl, auth, setAuth }) {
  const navigate = useNavigate();
  const location = useLocation();
  const token = auth?.access;
  const [teams, setTeams] = useState(() => (Array.isArray(auth?.teams) ? auth.teams : []));
  const [selectedTeam, setSelectedTeam] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const storedTeam = window.localStorage.getItem('scSelectedTeam');
        if (storedTeam) {
          const parsedStored = Number(storedTeam);
          return Number.isNaN(parsedStored) ? storedTeam : parsedStored;
        }
      } catch (err) {
        // ignore storage issues
      }
    }
    const firstTeamId = auth?.teams?.[0]?.id;
    if (firstTeamId === undefined || firstTeamId === null) return null;
    const parsed = Number(firstTeamId);
    return Number.isNaN(parsed) ? firstTeamId : parsed;
  });
  const [incidents, setIncidents] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [distributionLists, setDistributionLists] = useState([]);
  const [incidentForm, setIncidentForm] = useState(buildDefaultIncidentForm);
  const [preferredMessageTemplate, setPreferredMessageTemplate] = useState('incident');
  const [messageForm, setMessageForm] = useState(() => ({
    ...buildDefaultMessageForm(auth),
    templateType: 'incident',
  }));
  const [messageFiles, setMessageFiles] = useState([]);
  const [listForm, setListForm] = useState(defaultListForm);
  const [inlineListForm, setInlineListForm] = useState(defaultListForm);
  const [teamForm, setTeamForm] = useState(defaultTeamForm);
  const [closeForm, setCloseForm] = useState(defaultCloseForm);
  const [editingTeamId, setEditingTeamId] = useState(null);
  const [editingListId, setEditingListId] = useState(null);
  const [editingListTeamId, setEditingListTeamId] = useState(null);
  const [summary, setSummary] = useState({ open_incident_count: 0, recent_messages: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [activeSubNav, setActiveSubNav] = useState('overview');
  const [toastMessage, setToastMessage] = useState('');
  const [emailSuccessModalVisible, setEmailSuccessModalVisible] = useState(false);
  const [activeIncidentModal, setActiveIncidentModal] = useState(null);
  const [pendingPanelFromQuery, setPendingPanelFromQuery] = useState(null);
  const [showInlineListModal, setShowInlineListModal] = useState(false);
  const [forceTeamFromIncident, setForceTeamFromIncident] = useState(false);
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('all');
  const refreshPromiseRef = useRef(null);
  const settingsMenuRef = useRef(null);
  const toastTimeoutRef = useRef(null);

  const previousIncidentRef = useRef(null);
  const incidentNextCommunicationRef = useRef(null);
  const messageNextCommunicationRef = useRef(null);
  const lastTemplateAppliedRef = useRef(null);

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
      const normalized = value ? Number(value) : null;
      setSelectedTeam(Number.isNaN(normalized) ? null : normalized);
    },
    [setSelectedTeam]
  );

  const confirmDateSelection = useCallback((inputRef, message, onConfirm) => {
    if (typeof onConfirm === 'function') {
      onConfirm();
    }
    if (inputRef?.current) {
      inputRef.current.blur();
    }
    if (message) {
      showToast(message);
    }
  }, [showToast]);

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
        localStorage.setItem('nmsAuth', JSON.stringify(nextAuth));
      } else {
        localStorage.removeItem('nmsAuth');
      }
      setAuth(nextAuth);
    },
    [setAuth]
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
      throw new Error('Session expired. Please sign in again.');
    }
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = (async () => {
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
          persistAuth(null);
          navigate('/dashboard');
          throw new Error(data?.detail || 'Session expired. Please sign in again.');
        }
        const nextAuth = {
          ...(auth || {}),
          access: data.access,
          refresh: data.refresh || auth.refresh,
        };
        persistAuth(nextAuth);
        return nextAuth.access;
      })().finally(() => {
        refreshPromiseRef.current = null;
      });
    }
    return refreshPromiseRef.current;
  }, [apiBaseUrl, auth, navigate, persistAuth]);

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
            return execute(newAccess);
          }
          persistAuth(null);
          navigate('/dashboard');
        }
        throw err;
      }
    },
    [auth?.refresh, fetchWithToken, navigate, persistAuth, refreshAccessToken]
  );

  const handleNavigateHome = useCallback(() => {
    setShowSettingsDropdown(false);
    navigate('/dashboard');
    if (typeof window !== 'undefined') {
      window.location.assign('/dashboard');
    }
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

  useEffect(() => {
    if (!token) {
      navigate('/dashboard');
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
        await Promise.all([loadIncidents(), loadDistributionLists(initialTeam), loadSummary()]);
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
    if (selectedTeam) {
      setSelectedIncident(null);
      loadIncidents();
      loadDistributionLists();
    } else {
      loadDistributionLists(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam]);
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
    if (selectedIncident) {
      loadMessages(selectedIncident);
    } else {
      setMessages([]);
    }
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
        normalized.some((team) => Number(team.id) === Number(prevSelected))
      ) {
        nextTeamSelection = prevSelected;
        return prevSelected;
      }
      const fallback = normalized.length ? Number(normalized[0].id) : null;
      const sanitized = fallback !== null && !Number.isNaN(fallback) ? fallback : null;
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

  const loadDistributionLists = async (teamId = selectedTeam) => {
    const normalizeListArray = (lists) => toArray(lists).map(normalizeDistributionListItem);
    const globalPromise = apiRequest('/distribution-lists/?team=global');
    if (!teamId) {
      const globalLists = normalizeListArray(await globalPromise);
      setDistributionLists(globalLists);
      return;
    }
    const [teamLists, globalLists] = await Promise.all([
      apiRequest(`/distribution-lists/?team=${teamId}`),
      globalPromise,
    ]);
    const normalizedTeamLists = normalizeListArray(teamLists);
    const normalizedGlobalLists = normalizeListArray(globalLists);
    setDistributionLists([...normalizedTeamLists, ...normalizedGlobalLists]);
  };

  const normalizeDistributionListItem = (list) => {
    if (!list) return list;
    const normalizeTeamValue = (value) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'object') {
        const candidate = value.id ?? value.pk ?? null;
        return normalizeTeamValue(candidate);
      }
      if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        if (!trimmed || trimmed === 'global' || trimmed === 'null') {
          return null;
        }
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return null;
      }
      return parsed;
    };
    const normalizedTeam = normalizeTeamValue(list.team);
    const normalizedId = (() => {
      if (list.id === undefined || list.id === null) return list.id;
      const parsed = Number(list.id);
      return Number.isNaN(parsed) ? list.id : parsed;
    })();
    const derivedScope = normalizedTeam === null ? 'global' : 'team';
    const normalizedScope = (() => {
      if (typeof list.scope === 'string' && list.scope.trim()) {
        return list.scope.trim().toLowerCase();
      }
      return derivedScope;
    })();
    return {
      ...list,
      id: normalizedId,
      team: normalizedTeam,
      scope: normalizedScope,
    };
  };

  const mergeDistributionListItem = useCallback(
    (list) => {
      if (!list || !list.id) return;
      const normalized = normalizeDistributionListItem(list);
      setDistributionLists((prev) => {
        const current = Array.isArray(prev) ? [...prev] : [];
        const existingIndex = current.findIndex((item) => item.id === normalized.id);
        if (existingIndex >= 0) {
          current[existingIndex] = { ...current[existingIndex], ...normalized };
          return current;
        }
        return [...current, normalized];
      });
    },
    [setDistributionLists]
  );

  const formatApiError = useCallback((err) => {
    if (!err) return 'Something went wrong. Please try again.';
    const data = err.responseData;
    if (data) {
      if (Array.isArray(data.non_field_errors) && data.non_field_errors.length) {
        return data.non_field_errors.join(' ');
      }
      if (Array.isArray(data.entries)) {
        const entryMessages = data.entries
          .map((entryErr, index) => {
            if (!entryErr) return null;
            const fieldMessages = Object.entries(entryErr)
              .map(([field, value]) => {
                if (Array.isArray(value) && value.length) {
                  return `${field.charAt(0).toUpperCase() + field.slice(1)} ${index + 1}: ${value.join(', ')}`;
                }
                if (typeof value === 'string' && value.trim()) {
                  return `${field.charAt(0).toUpperCase() + field.slice(1)} ${index + 1}: ${value}`;
                }
                return null;
              })
              .filter(Boolean);
            return fieldMessages.join(' ');
          })
          .filter(Boolean);
        if (entryMessages.length) {
          return entryMessages.join(' ');
        }
      }
      const otherField = Object.entries(data)
        .map(([field, value]) => {
          if (Array.isArray(value) && value.length) {
            return `${field}: ${value.join(', ')}`;
          }
          if (typeof value === 'string' && value.trim()) {
            return `${field}: ${value}`;
          }
          return null;
        })
        .filter(Boolean);
      if (otherField.length) {
        return otherField[0];
      }
    }
    return err.message || 'Something went wrong. Please try again.';
  }, []);

  const distributionLookup = useMemo(() => {
    const map = new Map();
    (distributionLists || []).forEach((list) => map.set(list.id, list));
    return map;
  }, [distributionLists]);

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

  const availableLists = useMemo(() => {
    const lists = Array.isArray(distributionLists) ? distributionLists : [];
    if (!selectedTeam) return lists;
    return lists.filter((list) => list.team === selectedTeam || list.scope === 'global');
  }, [distributionLists, selectedTeam]);

  const selectedIncidentDetails = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncident),
    [incidents, selectedIncident]
  );

  const selectedTeamLabel = useMemo(() => {
    if (!selectedTeam) return '';
    const found = (teams || []).find((team) => Number(team.id) === Number(selectedTeam));
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
      (incidents || []).filter(
        (incident) => (incident.status || '').toLowerCase() !== 'closed'
      ).length,
    [incidents]
  );

  const teamOpenIncidentsCount = useMemo(
    () =>
      filteredIncidents.filter(
        (incident) => (incident.status || '').toLowerCase() !== 'closed'
      ).length,
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
    setIncidentForm((prev) => {
      const allowedIds = availableLists.map((list) => list.id);
      const filtered = prev.distributionLists.filter((id) => allowedIds.includes(id));
      if (filtered.length) {
        const sameLength = filtered.length === prev.distributionLists.length;
        const sameOrder = sameLength && filtered.every((id, idx) => id === prev.distributionLists[idx]);
        if (sameOrder) {
          return prev;
        }
        return { ...prev, distributionLists: filtered };
      }
      if (!availableLists.length) {
        return prev.distributionLists.length ? { ...prev, distributionLists: [] } : prev;
      }
      const defaultSelection = [availableLists[0].id];
      const alreadyDefault =
        prev.distributionLists.length === 1 && prev.distributionLists[0] === defaultSelection[0];
      return alreadyDefault ? prev : { ...prev, distributionLists: defaultSelection };
    });
  }, [availableLists]);

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
    const fallbackSummary =
      incident?.summary || incident?.problem_description || messageForm.problemDescription || '';
    const fallbackTitle = incident?.title || incident?.summary || messageForm.subject || '';
    const nextCommunicationValue =
      incident?.next_communication_time ||
      (messageForm.nextCommunicationTime ? normalizeDateForApi(messageForm.nextCommunicationTime) : null);
    const formattedNextUpdate = nextCommunicationValue ? formatDateTime(nextCommunicationValue) : '';
    return {
      title: fallbackTitle,
      summary: fallbackSummary,
      impact: incident?.impact || '',
      severity: incident?.severity || '',
      status: incident?.status || '',
      next_update: formattedNextUpdate,
      effective_date: formattedNextUpdate,
    };
  }, [
    selectedIncidentDetails,
    messageForm.problemDescription,
    messageForm.subject,
    messageForm.nextCommunicationTime,
  ]);

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
      };
    },
    [templateLookup, messageTemplateContext]
  );

  const messageTemplatePreview = useMemo(
    () => getTemplatePreview(messageForm.templateType),
    [getTemplatePreview, messageForm.templateType]
  );

  useEffect(() => {
    if (!messageTemplatePreview) return;
    setMessageForm((prev) => {
      if (prev.subject || prev.body) {
        return prev;
      }
      lastTemplateAppliedRef.current = prev.templateType;
      return {
        ...prev,
        subject: messageTemplatePreview.subject,
        body: messageTemplatePreview.body,
      };
    });
  }, [messageTemplatePreview]);

  useEffect(() => {
    if (!messageTemplatePreview) return;
    if (lastTemplateAppliedRef.current === messageForm.templateType) {
      return;
    }
    lastTemplateAppliedRef.current = messageForm.templateType;
    setMessageForm((prev) => ({
      ...prev,
      subject: messageTemplatePreview.subject,
      body: messageTemplatePreview.body,
    }));
  }, [messageForm.templateType, messageTemplatePreview]);

  useEffect(() => {
    setMessageForm((prev) => ({
      ...prev,
      pointOfContact: prev.pointOfContact || getDefaultPointOfContact(auth),
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
    setMessageForm((prev) => ({
      ...prev,
      pointOfContact: prev.pointOfContact || getDefaultPointOfContact(auth),
      problemDescription: details.problem_description || '',
      workaround: details.workaround || '',
      nextCommunicationTime: toLocalInputValue(details.next_communication_time),
      distributionLists: Array.isArray(details.distribution_lists)
        ? details.distribution_lists
        : [],
      templateType: prev.templateType || preferredMessageTemplate,
    }));
  }, [selectedIncident, incidents, auth, preferredMessageTemplate]);

  useEffect(() => {
    setActiveIncidentModal(null);
  }, [selectedIncident]);

  useEffect(() => {
    setMessageForm((prev) => {
      const allowedIds = availableLists.map((list) => list.id);
      const filtered = prev.distributionLists.filter((id) => allowedIds.includes(id));
      let nextLists = filtered;
      if (!filtered.length) {
        const incidentDefaults = (Array.isArray(selectedIncidentDetails?.distribution_lists)
          ? selectedIncidentDetails.distribution_lists
          : []
        ).filter((id) => allowedIds.includes(id));
        if (incidentDefaults.length) {
          nextLists = incidentDefaults;
        } else if (allowedIds.length) {
          nextLists = [allowedIds[0]];
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
  }, [availableLists, selectedIncidentDetails]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const incidentParam = params.get('incident');
    const panelParam = params.get('panel');
    if (incidentParam) {
      const parsed = Number(incidentParam);
      const normalized = Number.isNaN(parsed) ? incidentParam : parsed;
      setSelectedIncident((prev) => (prev === normalized ? prev : normalized));
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

  const handleIncidentDistributionChange = (event) => {
    const values = Array.from(event.target.selectedOptions).map((option) => Number(option.value));
    setIncidentForm({ ...incidentForm, distributionLists: values });
  };

  const handleMessageDistributionChange = (event) => {
    const values = Array.from(event.target.selectedOptions).map((option) => Number(option.value));
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
      setError('Next communication time is required.');
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
        },
      });
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
          const createdId = Number(created.id);
          setSelectedTeam(Number.isNaN(createdId) ? created.id : createdId);
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
    const allowedIds = availableLists.map((list) => list.id);
    const fallbackLists = (Array.isArray(selectedIncidentDetails?.distribution_lists)
      ? selectedIncidentDetails.distribution_lists
      : []
    ).map(Number);
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

      setMessageForm(() => ({
        ...buildDefaultMessageForm(auth),
        templateType: preferredMessageTemplate,
        problemDescription: selectedIncidentDetails?.problem_description || '',
        workaround: selectedIncidentDetails?.workaround || '',
        nextCommunicationTime: toLocalInputValue(selectedIncidentDetails?.next_communication_time),
        distributionLists: selectedIncidentDetails?.distribution_lists || [],
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

const parseEntriesFromEmails = (rawInput) => {
  return (rawInput || '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [address, entryDescription] = item.split('|').map((part) => part.trim());
      return {
        email: address,
        description: entryDescription || '',
      };
    });
};

  const formatEntriesForInput = (entries) => {
    if (!Array.isArray(entries) || !entries.length) {
      return '';
    }
    return entries
      .map((entry) => (entry.description ? `${entry.email} | ${entry.description}` : entry.email))
      .join('\n');
  };

  const resetListForm = () => {
    setListForm(defaultListForm);
    setEditingListId(null);
    setEditingListTeamId(null);
  };

  const handleDistributionListSubmit = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError('');
      const entries = parseEntriesFromEmails(listForm.emails);
      const targetTeam =
        editingListId != null
          ? editingListTeamId
          : listForm.scope === 'team'
          ? selectedTeam
          : null;
      if (listForm.scope === 'team' && !targetTeam) {
        throw new Error('Select a team before creating a team-scoped list.');
      }
      const payload = {
        name: listForm.name,
        description: listForm.description,
        team: targetTeam,
        entries,
      };
      let result = null;
      if (editingListId) {
        result = await apiRequest(`/distribution-lists/${editingListId}/`, {
          method: 'PATCH',
          body: payload,
        });
        showToast('Distribution list updated');
      } else {
        result = await apiRequest('/distribution-lists/', {
          method: 'POST',
          body: payload,
        });
        showToast('Distribution list is created');
        if (result?.id) {
          const normalizedId = Number.isNaN(Number(result.id)) ? result.id : Number(result.id);
          setIncidentForm((prev) => ({
            ...prev,
            distributionLists: Array.from(new Set([...prev.distributionLists, normalizedId])),
          }));
        }
      }
      if (result?.id) {
        mergeDistributionListItem(result);
      }
      resetListForm();
      await loadDistributionLists();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDistributionListEdit = (list) => {
    if (!list) return;
    setEditingListId(list.id);
    setEditingListTeamId(list.team || null);
    setListForm({
      name: list.name || '',
      description: list.description || '',
      emails: formatEntriesForInput(list.entries),
      scope: list.team ? 'team' : 'global',
    });
    setActiveSubNav('lists');
  };

  const handleDistributionListDelete = async (listId) => {
    if (!listId) return;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Delete this distribution list?');
      if (!confirmed) {
        return;
      }
    }
    try {
      setLoading(true);
      setError('');
      await apiRequest(`/distribution-lists/${listId}/`, { method: 'DELETE' });
      if (editingListId === listId) {
        resetListForm();
      }
      showToast('Distribution list deleted');
      await loadDistributionLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openInlineListModal = () => {
    setInlineListForm({
      name: '',
      description: '',
      emails: '',
      scope: selectedTeam ? 'team' : 'global',
    });
    setShowInlineListModal(true);
  };

  const closeInlineListModal = () => {
    setShowInlineListModal(false);
    setInlineListForm(defaultListForm);
  };

  const handleInlineListSubmit = async (event) => {
    event.preventDefault();
    if (!inlineListForm.name.trim()) {
      setError('List name is required.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const entries = parseEntriesFromEmails(inlineListForm.emails);
      const payload = {
        name: inlineListForm.name.trim(),
        description: inlineListForm.description,
        entries,
      };
      if (inlineListForm.scope === 'team') {
        if (!selectedTeam) {
          setError('Select a team before creating a team-scoped list.');
          return;
        }
        payload.team = selectedTeam;
      } else {
        payload.team = null;
      }
      const created = await apiRequest('/distribution-lists/', {
        method: 'POST',
        body: payload,
      });
      showToast('Distribution list created');
      closeInlineListModal();
      await loadDistributionLists();
      if (created?.id) {
        mergeDistributionListItem(created);
        const normalizedId = Number.isNaN(Number(created.id)) ? created.id : Number(created.id);
        setIncidentForm((prev) => {
          const nextLists = Array.from(new Set([...(prev.distributionLists || []), normalizedId]));
          return { ...prev, distributionLists: nextLists };
        });
      }
    } catch (err) {
      setError(formatApiError(err));
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
          distribution_list: closeForm.distribution_list || null,
        },
      });
      setCloseForm(defaultCloseForm);
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
                      <strong>{item.incident_reference}</strong> — {item.subject}
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
                        <strong>{item.incident_reference}</strong> — {item.subject}
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
                    setSelectedTeam(value ? Number(value) : null);
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
                <p>Template library is available directly inside the Email Timeline so you can preview and select wording without leaving the workflow.</p>
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
                      <label
                        key={region}
                        className={`chip-control${isChecked ? ' active' : ''}`}
                      >
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
                    value={incidentForm.nextCommunicationTime}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setIncidentForm({ ...incidentForm, nextCommunicationTime: nextValue });
                      if (nextValue) {
                        confirmDateSelection(incidentNextCommunicationRef, 'Next communication updated');
                      }
                    }}
                    required
                  />
                  <button
                    type="button"
                    className="date-ok-button"
                    onClick={() => confirmDateSelection(incidentNextCommunicationRef, 'Next communication updated')}
                  >
                    OK
                  </button>
                </div>
              </label>
              <label className="form-field">
                <span>Templates</span>
                <select
                  value={incidentForm.templateType}
                  onChange={(e) =>
                    setIncidentForm({ ...incidentForm, templateType: e.target.value })
                  }
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
                  <button type="button" className="text-link" onClick={openInlineListModal}>
                    + Create Distribution List
                  </button>
                </div>
                <select
                  multiple
                  value={incidentForm.distributionLists.map(String)}
                  onChange={handleIncidentDistributionChange}
                  required
                >
                  {availableLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
                {availableLists.length === 0 && (
                  <small className="form-hint">
                    No distribution lists yet. Use "Create Distribution List" to add one before saving.
                  </small>
                )}
              </label>
              <button type="submit" className="primary" disabled={loading}>
                Save Incident
              </button>
            </form>
          </section>
        );
      case 'active':
        return (
          <div className="tab-stack">
            <section className="tab-panel">
              <div className="panel-header compact">
                <h2>All Incidents</h2>
                <div
                  className="incident-filter-chips"
                  role="group"
                  aria-label="Filter incidents by status"
                >
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
                      <div>
                        <strong>{incident.reference_id || incident.inc_number || incident.id}</strong> — {incident.title}
                        <span className={`status-pill ${incident.status}`}>{incident.status}</span>
                      </div>
                      <small>
                        {incident.inc_number ? `${incident.inc_number} • ` : ''}
                        {incident.incident_type?.toUpperCase()}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-state">
                  {selectedTeam
                    ? 'No incidents match the selected filters.'
                    : 'Select a team to view incidents.'}
                </p>
              )}
            </section>
            <section className="tab-panel">
              <h2>Incident Workspace</h2>
              {selectedIncidentDetails ? (
                <>
                  <div className="incident-details-card">
                    <p>
                      <strong>INC:</strong> {selectedIncidentDetails.inc_number || '—'}
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
                      <strong>Affected Regions:</strong> {Array.isArray(selectedIncidentDetails.affected_regions) &&
                      selectedIncidentDetails.affected_regions.length
                        ? selectedIncidentDetails.affected_regions.join(', ')
                        : '—'}
                    </p>
                    <p>
                      <strong>Next Communication:</strong> {formatDateTime(selectedIncidentDetails.next_communication_time)}
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
      case 'lists':
        return (
          <div className="tab-stack">
            <section className="tab-panel">
              <h2>{editingListId ? 'Edit Distribution List' : 'Create Distribution List'}</h2>
              <form onSubmit={handleDistributionListSubmit} className="form-grid sc-form">
                <label className="form-field">
                  <span>List Name</span>
                  <input
                    type="text"
                    placeholder="List name"
                    value={listForm.name}
                    onChange={(e) => setListForm({ ...listForm, name: e.target.value })}
                    required
                  />
                </label>
                <label className="form-field">
                  <span>Description</span>
                  <textarea
                    placeholder="List description"
                    value={listForm.description}
                    onChange={(e) => setListForm({ ...listForm, description: e.target.value })}
                  />
                </label>
                <label className="form-field">
                  <span>Email Addresses</span>
                  <textarea
                    placeholder="one@example.com | optional description"
                    value={listForm.emails}
                    onChange={(e) => setListForm({ ...listForm, emails: e.target.value })}
                  />
                </label>
                <div className="radio-group radio-row">
                  <label className={`chip-control${listForm.scope === 'team' ? ' active' : ''}`}>
                    <input
                      type="radio"
                      value="team"
                      checked={listForm.scope === 'team'}
                      disabled={Boolean(editingListId)}
                      onChange={(e) => setListForm({ ...listForm, scope: e.target.value })}
                    />
                    <span>Team list</span>
                  </label>
                  <label className={`chip-control${listForm.scope === 'global' ? ' active' : ''}`}>
                    <input
                      type="radio"
                      value="global"
                      checked={listForm.scope === 'global'}
                      disabled={Boolean(editingListId)}
                      onChange={(e) => setListForm({ ...listForm, scope: e.target.value })}
                    />
                    <span>Global list</span>
                  </label>
                </div>
                <div className="form-actions">
                    <button type="submit" className="primary" disabled={loading}>
                      {editingListId ? 'Update Distribution List' : 'Save Distribution List'}
                    </button>
                    {editingListId && (
                      <button type="button" className="secondary" onClick={resetListForm}>
                        Cancel
                      </button>
                    )}
                </div>
              </form>
            </section>
            <section className="tab-panel">
              <h2>Stored Lists</h2>
              <ul className="list-view">
                {distributionLists.length ? (
                  distributionLists.map((list) => (
                    <li key={list.id}>
                      <div className="list-item-header">
                        <div>
                          <strong>{list.name}</strong> ({list.scope})
                        </div>
                        {list.can_manage && (
                          <div className="list-actions">
                            <button type="button" onClick={() => handleDistributionListEdit(list)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => handleDistributionListDelete(list.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                      {list.description && <p>{list.description}</p>}
                      <small>{Array.isArray(list.entries) ? list.entries.length : 0} recipients</small>
                      <br />
                      <small>Created by: {list.created_by_name || '—'}</small>
                    </li>
                  ))
                ) : (
                  <li>No lists available yet.</li>
                )}
              </ul>
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  const showTimelineModal = activeIncidentModal === 'timeline' && Boolean(selectedIncidentDetails);
  const showCloseModal = activeIncidentModal === 'close' && Boolean(selectedIncidentDetails);
  const showListModal = showInlineListModal;
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
              <strong>INC:</strong> {selectedIncidentDetails?.inc_number || '—'}
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
            {templateOptions.length > 0 && (
              <div className="template-gallery">
                <div className="template-gallery-header">
                  <strong>Template Library</strong>
                  <small>Select a template to set the default for Email Timeline.</small>
                </div>
                <div className="template-gallery-scroll">
                  {templateOptions.map((template) => (
                    <article
                      key={template.id}
                      className={`template-card${preferredMessageTemplate === template.id ? ' selected' : ''}`}
                    >
                      <div className="template-card-header">
                        <div>
                          <div className="template-label">{template.label}</div>
                          <small className="template-id">ID: {template.id}</small>
                        </div>
                      </div>
                      <div className="template-subject">
                        <strong>Subject</strong>
                        <div className="template-snippet">{template.subject || '—'}</div>
                      </div>
                      <div className="template-body">
                        <strong>Body</strong>
                        <pre>{template.body || '—'}</pre>
                      </div>
                      <div className="template-card-actions">
                        <button
                          type="button"
                          className={`secondary template-select ${
                            preferredMessageTemplate === template.id ? 'active' : ''
                          }`}
                          onClick={() => handleSetDefaultTemplate(template.id)}
                        >
                          {preferredMessageTemplate === template.id ? 'Selected for Timeline' : 'Use this template'}
                        </button>
                      </div>
                    </article>
                  ))}
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
              <span>Email Body</span>
              <textarea
                placeholder="Email body"
                value={messageForm.body}
                onChange={(e) => setMessageForm({ ...messageForm, body: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <div className="field-header">
                <span>Distribution Lists</span>
                <button type="button" className="text-link" onClick={openInlineListModal}>
                  + Create Distribution List
                </button>
              </div>
              <select
                multiple
                value={messageForm.distributionLists.map(String)}
                onChange={handleMessageDistributionChange}
              >
                {availableLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
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
                  value={messageForm.nextCommunicationTime}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setMessageForm({ ...messageForm, nextCommunicationTime: nextValue });
                    if (nextValue) {
                      confirmDateSelection(messageNextCommunicationRef, 'Message next communication updated');
                    }
                  }}
                />
                <button
                  type="button"
                  className="date-ok-button"
                  onClick={() =>
                    confirmDateSelection(messageNextCommunicationRef, 'Message next communication updated')
                  }
                >
                  OK
                </button>
              </div>
            </label>
            <label className="form-field">
              <span>Extra Recipients</span>
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
                <p>{message.body}</p>
                <div className="timeline-meta">
                  <small>POC: {message.point_of_contact || '—'}</small>
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
                    const listNames = [...(message.distribution_lists || [])].map(
                      (id) => distributionLookup.get(id)?.name || `List ${id}`
                    );
                    if (!listNames.length && message.distribution_list) {
                      listNames.push(
                        distributionLookup.get(message.distribution_list)?.name ||
                          `List ${message.distribution_list}`
                      );
                    }
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
              <span>Distribution List</span>
              <select
                value={closeForm.distribution_list}
                onChange={(e) => setCloseForm({ ...closeForm, distribution_list: e.target.value })}
              >
                <option value="">Use incident default list</option>
                {availableLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
                    <button type="submit" className="primary" disabled={loading}>
                      Close Incident & Notify
                    </button>
                  </form>
        </div>
      </div>
    </div>
  ) : null;

  const inlineListModal = showListModal ? (
    <div className="sc-modal-overlay" role="dialog" aria-modal="true" onClick={closeInlineListModal}>
      <div className="sc-modal" onClick={(event) => event.stopPropagation()}>
        <div className="sc-modal-header">
          <h3>Create Distribution List</h3>
          <button type="button" className="modal-close" onClick={closeInlineListModal} aria-label="Close dialog">
            ✖
          </button>
        </div>
        <div className="sc-modal-body">
          <form onSubmit={handleInlineListSubmit} className="form-grid sc-form">
            <label className="form-field">
              <span>List Name</span>
              <input
                type="text"
                placeholder="List name"
                value={inlineListForm.name}
                onChange={(e) => setInlineListForm({ ...inlineListForm, name: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span>Description</span>
              <textarea
                placeholder="Optional description"
                value={inlineListForm.description}
                onChange={(e) => setInlineListForm({ ...inlineListForm, description: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Email Addresses</span>
              <textarea
                placeholder="one@example.com | optional description"
                value={inlineListForm.emails}
                onChange={(e) => setInlineListForm({ ...inlineListForm, emails: e.target.value })}
              />
            </label>
            <div className="radio-group radio-row">
              <label className={`chip-control${inlineListForm.scope === 'team' ? ' active' : ''}`}>
                <input
                  type="radio"
                  value="team"
                  checked={inlineListForm.scope === 'team'}
                  onChange={(e) => setInlineListForm({ ...inlineListForm, scope: e.target.value })}
                />
                <span>Team list</span>
              </label>
              <label className={`chip-control${inlineListForm.scope === 'global' ? ' active' : ''}`}>
                <input
                  type="radio"
                  value="global"
                  checked={inlineListForm.scope === 'global'}
                  onChange={(e) => setInlineListForm({ ...inlineListForm, scope: e.target.value })}
                />
                <span>Global list</span>
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" className="primary" disabled={loading}>
                Save Distribution List
              </button>
              <button type="button" className="secondary" onClick={closeInlineListModal}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="app-shell service-communications">
      <header className="app-header sc-header">
        <div className="sc-branding">
          <img src="logo_left.png" alt="Network Operations" className="sc-logo" />
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
                <button type="button" onClick={handleNavigateHome}>
                  🏠 Home
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
      {inlineListModal}

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

      <AppFooter apiBaseUrl={apiBaseUrl} />

      {loading && <div className="backdrop">Working...</div>}
    </div>
  );
}

export default Dashboard;
