// src/components/Ping.js
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { flushSync } from 'react-dom';
import AppFooter from './AppFooter';
import '../assets/Ping.css';

function Ping({ apiBaseUrl, setAuth, auth }) {
  const navigate = useNavigate();
  const allOps = [
    'enable_ping',
    'verbose_ping',
    'traceroute',
    'dns_lookup',
    'verbos_dns_lookup',
    'simple_snmp_walk',
    'mtr',
    'snmp_walk',
  ];

  const [operations, setOperations] = useState(() =>
    Object.fromEntries(allOps.map((op) => [op, false]))
  );
  const [startIp, setStartIp] = useState('');
  const [results, setResults] = useState([]);
  const [emailList, setEmailList] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [snmpVersion, setSnmpVersion] = useState('2c');
  const [showAbout, setShowAbout] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [lastRunAt, setLastRunAt] = useState(null);
  const settingsMenuRef = useRef(null);
  const storedAuth = useMemo(() => {
    try {
      const raw = localStorage.getItem('nmsAuth');
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }, []);
  const effectiveAuth = auth || storedAuth;
  const profileDisplayName = useMemo(() => {
    const first = (effectiveAuth?.user?.first_name || '').trim();
    if (first) return first;
    const fallback = (effectiveAuth?.user?.name || '').trim();
    if (fallback) {
      const [firstWord] = fallback.split(/\s+/);
      if (firstWord) return firstWord;
    }
    const email = (effectiveAuth?.user?.email || '').trim();
    if (email) {
      const [localPart] = email.split('@');
      if (localPart) return localPart;
    }
    return 'Network User';
  }, [effectiveAuth]);
  const userInitials = useMemo(() => {
    const first = (effectiveAuth?.user?.first_name || '').trim();
    const last = (effectiveAuth?.user?.last_name || '').trim();
    const initials = `${first.charAt(0)}${last.charAt(0)}`.trim();
    if (initials) return initials.toUpperCase();
    const email = effectiveAuth?.user?.email || '';
    return email.slice(0, 2).toUpperCase() || 'NU';
  }, [effectiveAuth]);


  useEffect(() => {
    const storedIp = sessionStorage.getItem('ip_address');
    if (storedIp) setStartIp(storedIp);
  }, []);

  useEffect(() => {
    const storedLastRun = sessionStorage.getItem('last_run_at');
    if (storedLastRun) setLastRunAt(storedLastRun);
  }, []);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target)) {
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    sessionStorage.setItem('ip_address', startIp);
  }, [startIp]);

  useEffect(() => {
    if (lastRunAt) {
      sessionStorage.setItem('last_run_at', lastRunAt);
    }
  }, [lastRunAt]);

  function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.startsWith(name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }

  const handleLogout = async () => {
    try {
      setLoading(true);
      const csrfToken = getCookie('csrftoken');
      const response = await fetch(`${apiBaseUrl}/logout/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRFToken': csrfToken,
        },
      });

      const data = await response.json();
      if (data.success && data.logout_url) {
        window.location.href = data.logout_url;
        return;
      }

      if (response.ok) {
        localStorage.removeItem('nmsAuth');
        if (typeof setAuth === 'function') {
          setAuth(null);
        }
        navigate('/');
      } else {
        console.error('Logout failed:', data.message || 'Unknown error');
      }
    } catch (error) {
      console.error('Logout error:', error);
    }finally{
      setLoading(false);
    }
  };

  const handleServiceCommunications = async () => {
    try {
      setLoading(true);
      const csrfToken = getCookie('csrftoken');
      const response = await fetch(`${apiBaseUrl}/auth/session-login/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Unable to open Service Communications.');
      }
      flushSync(() => {
        localStorage.setItem('nmsAuth', JSON.stringify(data));
        if (typeof setAuth === 'function') {
          setAuth(data);
        }
      });
      setShowSettingsDropdown(false);
      navigate('/service-communications');
    } catch (error) {
      console.error('Service Communications error:', error);
      alert(error.message || 'Failed to load Service Communications.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    if (name === 'snmp_walk') {
      setOperations((prev) => {
        if (checked) {
          return { ...Object.fromEntries(allOps.map((op) => [op, false])), snmp_walk: true };
        } else {
          return { ...prev, snmp_walk: false };
        }
      });
    } else {
      if (operations.snmp_walk) return;
      setOperations((prev) => ({
        ...prev,
        [name]: checked,
      }));
    }
  };

  const handleSelectAll = () => {
    if (operations.snmp_walk) return;
    const allMajorSelected = allOps
      .filter((op) => op !== 'snmp_walk')
      .every((op) => operations[op]);
    const newOps = {};
    allOps.forEach((op) => {
      newOps[op] = op === 'snmp_walk' ? false : !allMajorSelected;
    });
    setOperations(newOps);
  };

  const isSelectAllChecked = allOps
    .filter((op) => op !== 'snmp_walk')
    .every((op) => operations[op]);
  const showSnmpFields = operations.snmp_walk;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
        const formData = new FormData();
        formData.append('start_ip_address', startIp);
        Object.entries(operations).forEach(([key, value]) => {
        if (value) formData.append(key, '1');
        });
        formData.append('snmp_version', snmpVersion);

        if (operations.snmp_walk || operations.simple_snmp_walk) {
        const communityInput = document.querySelector('input[name="community_string"]')?.value || 'public';
        const communityValues = communityInput
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
        if (communityValues.length) {
            communityValues.forEach((value) => formData.append('community_strings', value));
        } else {
            formData.append('community_strings', 'public');
        }

        formData.append('timeout', document.querySelector('input[name="timeout"]')?.value || '1000');

        if (snmpVersion === '3') {
            formData.append('username', document.querySelector('input[name="v3_username"]')?.value || '');
                formData.append('authentication_type', document.querySelector('input[name="auth_protocol"]')?.value || '');
            formData.append('password', document.querySelector('input[name="auth_password"]')?.value || '');
            formData.append('encryption_type', document.querySelector('input[name="priv_protocol"]')?.value || '');
            formData.append('encryption_key', document.querySelector('input[name="priv_password"]')?.value || '');
            formData.append('security_level', document.querySelector('input[name="security_level"]')?.value || '');
            formData.append('context_name', document.querySelector('input[name="context_name"]')?.value || '');
        }
        }

        const csrfToken = getCookie('csrftoken');
        const response = await fetch(`${apiBaseUrl}/dashboard/`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
            'X-CSRFToken': csrfToken,
        },
        });

        const data = await response.json();
        console.log(data);
        if (data.success) {
        const runTimestamp = new Date().toISOString();
        setResults(data.results);
        setLastRunAt(runTimestamp);
        } else {
        alert(data.error || 'Error processing the request.');
        }
    } catch (error) {
        console.error('Network error:', error);
    } finally {
        setLoading(false); // hide spinner
    }
    };


  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const buildEmailTableHtml = () => {
    if (!results.length) {
      return '<p>No network operations were executed.</p>';
    }
    const tableRows = results
      .map(
        ({ operation, result }) => `
        <tr>
          <td style="border:1px solid #d1d5db; padding:8px; font-weight:600;">${escapeHtml(operation)}</td>
          <td style="border:1px solid #d1d5db; padding:8px;">
            <pre style="margin:0; white-space:pre-wrap; font-family:SFMono-Regular,Menlo,monospace;">${escapeHtml(
              result
            )}</pre>
          </td>
        </tr>`
      )
      .join('');
    return `
      <div style="font-family:Arial,Helvetica,sans-serif; color:#0f172a;">
        <h2 style="margin-bottom:12px;">Network Operations Results</h2>
        <table style="border-collapse:collapse; width:100%; font-size:14px;">
          <thead>
            <tr>
              <th style="border:1px solid #d1d5db; background:#0f172a; color:#fff; text-align:left; padding:8px;">Operation</th>
              <th style="border:1px solid #d1d5db; background:#0f172a; color:#fff; text-align:left; padding:8px;">Result</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    `;
  };

  const handleSendEmail = async () => {
    const emailArray = emailList
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (!emailArray.length) {
      setEmailStatus({ type: 'error', message: 'Please enter at least one email recipient.' });
      return;
    }

    let bodyText = 'Results:\n\n';
    results.forEach(({ operation, result }) => {
      bodyText += `Operation: ${operation}\nResult: ${result}\n\n`;
    });
    if (!results.length) {
      bodyText += 'No network operations were executed.\n';
    }
    const htmlBody = buildEmailTableHtml();

    try {
      setEmailStatus({ type: 'info', message: 'Sending email…' });
      const res = await fetch(`${apiBaseUrl}/send-email/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email_list: emailArray, email_body: bodyText, email_html: htmlBody }),
      });
      const json = await res.json();
      if (json.success) {
        setEmailStatus({ type: 'success', message: 'Email sent successfully.' });
      } else {
        setEmailStatus({ type: 'error', message: json.message || 'Email sending failed.' });
      }
    } catch (error) {
      setEmailStatus({ type: 'error', message: 'Email sending failed. Please check the configuration.' });
    }
  };

  const downloadCSV = () => {
    let csv = 'Operation,Result\n';
    results.forEach(({ operation, result }) => {
      const cleanResult = result.replace(/\n/g, ' ').replace(/,/g, '');
      csv += `"${operation}","${cleanResult}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'network_operations.csv';
    link.click();
  };

  const clearForm = () => {
    setStartIp('');
    setOperations(Object.fromEntries(allOps.map((op) => [op, false])));
    setResults([]);
    setEmailList('');
    sessionStorage.removeItem('ip_address');
    setEmailStatus(null);
  };

  const activeOperationCount = Object.values(operations).filter(Boolean).length;

  const renderSNMPFields = () => {
    if (!showSnmpFields) return null;

    return (
      <div id="snmp_fields" className="snmp-fields">
        <label htmlFor="snmp_version">SNMP Version</label>
        <select
          name="snmp_version"
          id="snmp_version"
          value={snmpVersion}
          onChange={(e) => setSnmpVersion(e.target.value)}
        >
          <option value="1">v1</option>
          <option value="2c">v2c</option>
          <option value="3">v3</option>
        </select>

        {(snmpVersion === '2c' || snmpVersion === '3') && (
          <>
            <div>Community String</div>
            <input name="community_string" placeholder="public" />
            <div>Timeout (ms)</div>
            <input name="timeout" placeholder="1000" />
          </>
        )}

        {snmpVersion === '3' && (
          <>
            <div>Username</div>
            <input name="v3_username" />
            <div>Auth Protocol</div>
            <input name="auth_protocol" />
            <div>Auth Password</div>
            <input name="auth_password" type="password" />
            <div>Privacy Protocol</div>
            <input name="priv_protocol" />
            <div>Privacy Password</div>
            <input name="priv_password" type="password" />
            <div>Security Level</div>
            <input name="security_level" />
            <div>Context Name</div>
            <input name="context_name" />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="ping-container full-screen">
      <div className="topbar">
        <div className="left-section">
          <button className="menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            ☰
          </button>
          <img src="logo_left.png" alt="Left Logo" className="logo" />
        </div>
        <h2 className="title">
          Network Operations <span className="version-tag">v1.0</span>
        </h2>
        <div className="right-section">
          <img src="logo_right.png" alt="Right Logo" className="logo" />
          <div className="sc-settings-trigger" ref={settingsMenuRef}>
            <button
              type="button"
              className={`icon-button ${showSettingsDropdown ? 'active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={showSettingsDropdown}
              onClick={() => setShowSettingsDropdown((prev) => !prev)}
            >
              ⚙️
            </button>
            {showSettingsDropdown && (
              <div className="sc-settings-dropdown" role="menu">
                <div className="sc-profile-card" title={profileDisplayName}>
                  <div className="sc-avatar">{userInitials}</div>
                  <div className="sc-profile-details">
                    <span>{profileDisplayName}</span>
                    <small>Network Operations</small>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/user-activity');
                    setShowSettingsDropdown(false);
                  }}
                >
                  👤 User
                </button>
                <button type="button" onClick={handleServiceCommunications}>
                  🛰️ Service Communications
                </button>
                <button type="button" onClick={handleLogout}>
                  ↩ Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="main-layout">
        {loading && (
        <div className="spinner-overlay">
            <div className="spinner" />
        </div>
        )}

        {sidebarOpen && (
          <aside className="sidebar">
            <div className="operation-checkboxes">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="select_all"
                  checked={isSelectAllChecked}
                  onChange={handleSelectAll}
                  disabled={operations.snmp_walk}
                />
                Select All
              </label>

              {!operations.snmp_walk &&
                allOps
                  .filter((op) => op !== 'snmp_walk')
                  .map((op) => (
                    <label key={op} htmlFor={`chk_${op}`} className="checkbox-label">
                      <input
                        id={`chk_${op}`}
                        type="checkbox"
                        name={op}
                        checked={operations[op]}
                        onChange={handleCheckboxChange}
                      />
                      {op.replace(/_/g, ' ')}
                    </label>
                  ))}

              <label key="snmp_walk" htmlFor={`chk_snmp_walk`} className="checkbox-label">
                <input
                  id={`chk_snmp_walk`}
                  type="checkbox"
                  name="snmp_walk"
                  checked={operations.snmp_walk}
                  onChange={handleCheckboxChange}
                />
                snmp walk
              </label>

              {renderSNMPFields()}
            </div>

            <div className="footer-icons">
              <div style={{ cursor: 'pointer' }} onClick={() => setShowAbout(true)}>ℹ️ ABOUT</div>
              <div style={{ cursor: 'pointer' }} onClick={handleLogout}>↩ LOGOUT</div>
            </div>
          </aside>
        )}

        <main className="main-content">
          <section className="panel-card hero-card">
            <div className="hero-text">
              <h2>Network Operations Center</h2>
              <p>
                Execute diagnostics, observe telemetry, and share updates without leaving this dashboard.
              </p>
              <div className="action-toolbar">
                <button type="button" className="ghost-button" onClick={() => setShowAbout(true)}>
                  ℹ️ Quick tour
                </button>
              </div>
            </div>
            <div className="hero-stats">
              <div className="stat-chip">
                <span className="stat-label">Selected Ops</span>
                <strong>{activeOperationCount}</strong>
              </div>
              <div className="stat-chip">
                <span className="stat-label">Results</span>
                <strong>{results.length}</strong>
              </div>
              <div className="stat-chip">
                <span className="stat-label">Last Run</span>
                <strong>{lastRunAt ? new Date(lastRunAt).toLocaleTimeString() : '—'}</strong>
              </div>
            </div>
          </section>

          <section className="panel-card action-card">
            <form onSubmit={handleSubmit}>
              <div className="input-section">
                <input
                  className="ip-input"
                  name="start_ip"
                  type="text"
                  value={startIp}
                  onChange={(e) => setStartIp(e.target.value)}
                  placeholder="Enter IPs / ranges / hostnames"
                  required
                />
                <button type="submit">Run Diagnostics</button>
                <button className="danger-outline" type="button" onClick={clearForm}>
                  Clear
                </button>
              </div>
            </form>
            <div className="action-buttons">
              <button type="button" onClick={handleSelectAll} disabled={operations.snmp_walk}>
                {isSelectAllChecked ? 'Deselect All' : 'Select All'}
              </button>
              <button type="button" onClick={() => setSidebarOpen((prev) => !prev)}>
                {sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
              </button>
              <button type="button" onClick={downloadCSV}>
                Download CSV
              </button>
            </div>
          </section>

          <section className="panel-card results-card">
            <div className="results-section">
              <div className="results-header">
                <div>
                  <h3>Results</h3>
                  <p className="results-subtitle">
                    {results.length
                      ? 'Diagnostics are listed chronologically.'
                      : 'Run diagnostics to populate this feed.'}
                  </p>
                </div>
                <div className="email-actions">
                  <input
                    type="text"
                    name="email_list"
                    placeholder="Email addresses (comma separated)"
                    value={emailList}
                    onChange={(e) => setEmailList(e.target.value)}
                  />
                  <button type="button" onClick={handleSendEmail}>
                    Send Email
                  </button>
                </div>
              </div>
              {emailStatus && (
                <p className={`email-status email-status-${emailStatus.type}`}>{emailStatus.message}</p>
              )}
              {results.length ? (
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>Operation</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(({ operation, result }, i) => (
                      <tr key={i}>
                        <td>{operation}</td>
                        <td>
                          <pre>{result}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-results">
                  <p>No diagnostics yet. Select an operation and run your first test.</p>
                </div>
              )}
            </div>
          </section>
        </main>

        {showAbout && (
          <div className="about-popup">
            <div className="popup-overlay" onClick={() => setShowAbout(false)}></div>
            <div className="popup-content tour-panel">
              <button className="close-btn" onClick={() => setShowAbout(false)}>✖</button>
              <h3>About this workspace</h3>
              <p>
                Network Operations collects diagnostics (ping, traceroute, DNS, SNMP, MTR) and lets you
                notify distribution lists instantly. Service Communications manages teams, incidents, and
                distribution lists used for messaging stakeholders.
              </p>
              <div className="tour-columns">
                <div>
                  <h4>Network Operations</h4>
                  <ol>
                    <li>Select the checks you need from the sidebar.</li>
                    <li>Enter IPs, ranges, or hostnames and click Run Diagnostics.</li>
                    <li>Review results, export CSV, or email stakeholders.</li>
                  </ol>
                </div>
                <div>
                  <h4>Service Communications</h4>
                  <ol>
                    <li>Create or select a team to manage templates/lists.</li>
                    <li>Open incidents, send timeline updates, or close with final messaging.</li>
                    <li>Leverage distribution lists for consistent, audited communications.</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <AppFooter apiBaseUrl={apiBaseUrl} />
    </div>
  );
}

export default Ping;
