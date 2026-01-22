import { useEffect } from 'react';

const sanitizeBaseUrl = (url) => {
  if (!url) {
    return window.location.origin;
  }
  return url.replace(/\/$/, '');
};

function AdminRedirect({ adminBaseUrl }) {
  useEffect(() => {
    const base = sanitizeBaseUrl(adminBaseUrl);
    const path = window.location.pathname;
    const search = window.location.search;
    const hash = window.location.hash;
    const target = `${base}${path}${search}${hash || ''}`;

    if (window.location.href !== target) {
      window.location.replace(target);
    }
  }, [adminBaseUrl]);

  return null;
}

export default AdminRedirect;
