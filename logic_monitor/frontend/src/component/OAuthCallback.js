import { useEffect } from 'react';

function OAuthCallback({ apiBaseUrl }) {
  useEffect(() => {
    const query = window.location.search || '';
    const redirectUrl = `${apiBaseUrl}/oauth2/callback/${query}`;
    window.location.replace(redirectUrl);
  }, [apiBaseUrl]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <p>Completing sign-in…</p>
    </div>
  );
}

export default OAuthCallback;
