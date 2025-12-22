// src/components/UserActivity.js
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom'; // import useNavigate
import AppFooter from './AppFooter';
import '../assets/UserActivity.css';

const formatDateTimeIST = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
};

function UserActivity({ apiBaseUrl, auth }) {
  const navigate = useNavigate(); // initialize navigate
  const [loading, setLoading] = useState(true);
  const [activeUsers, setActiveUsers] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [activeUserCount, setActiveUserCount] = useState(0);
  const [error, setError] = useState(null);
  const token = auth?.access;

  useEffect(() => {
    if (!token) {
      setError('Authentication required');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/active-users/`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Your session expired. Please log in again.');
        }
        if (!res.ok) throw new Error('Failed to fetch user activity');
        return res.json();
      })
      .then((data) => {
        setActiveUsers(data.active_users || []);
        setActivityLogs(data.user_activities || []);
        setActiveUserCount(data.active_user_count || 0);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          return;
        }
        console.error(err);
        setError(err.message || 'Error loading activity');
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiBaseUrl, token]);

  if (loading) return <div className="activity-loader">Loading...</div>;
  if (error) return <div className="activity-error">Error: {error}</div>;

  return (
    <div className="user-activity-container">
      <button className="back-to-home-btn" onClick={() => navigate('/service-communications')}>
        ← Back to Home
      </button>

      <h3>Active Users ({activeUserCount})</h3>
      <ul className="active-user-list">
        {activeUsers.map((user) => (
          <li key={user.email}>
            <strong>{user.name || 'N/A'}</strong> ({user.email})
          </li>
        ))}
      </ul>

      <h4>Recent Activity Logs</h4>
      <table className="activity-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Activity Type</th>
            <th>Timestamp</th>
            <th>Duration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {activityLogs.map((log, index) => (
            <tr key={index}>
              <td>{log.name || '—'}</td>
              <td>{log.email}</td>
              <td>{log.activity_type}</td>
              <td>{formatDateTimeIST(log.timestamp)}</td>
              <td>{log.duration}</td>
              <td>{log.session_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <AppFooter apiBaseUrl={apiBaseUrl} />
    </div>
  );
}

export default UserActivity;
