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

function UserActivity({ apiBaseUrl }) {
  const navigate = useNavigate(); // initialize navigate
  const [loading, setLoading] = useState(true);
  const [activeUsers, setActiveUsers] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [activeUserCount, setActiveUserCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/active-users/`, {
      credentials: 'include',
    })
      .then((res) => {
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
        console.error(err);
        setError(err.message || 'Error loading activity');
        setLoading(false);
      });
  }, [apiBaseUrl]);

  if (loading) return <div className="activity-loader">Loading...</div>;
  if (error) return <div className="activity-error">Error: {error}</div>;

  return (
    <div className="user-activity-container">
      <button
        className="back-to-home-btn"
        onClick={() => navigate('/service-communications')}
        style={{ marginBottom: '20px', padding: '8px 16px', cursor: 'pointer' }}
      >
        ← Back to Home
      </button>

      <h3>Active Users ({activeUserCount})</h3>
      <ul className="active-user-list">
        {activeUsers.map((user) => (
          <li key={user.id}>
            <strong>{user.name || 'N/A'}</strong> ({user.email})
          </li>
        ))}
      </ul>

      <h4>Recent Activity Logs</h4>
      <table className="activity-table">
        <thead>
          <tr>
            <th>User ID</th>
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
              <td>{log.user_id}</td>
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
