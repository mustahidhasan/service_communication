import React, { useEffect, useState } from 'react';

const FOOTER_PREFIX =
  '"This application is continuously evolving, if you have suggestions for improvement? ';
const FOOTER_SUFFIX = '"';
const FALLBACK_EMAIL = 'support@service-communication.system';

const emailCache = new Map();
const emailPromiseCache = new Map();

const normalizeBase = (baseUrl) => {
  if (!baseUrl) return '/api';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

function AppFooter({ apiBaseUrl, metaBaseUrl }) {
  const normalizedBase = normalizeBase(metaBaseUrl || apiBaseUrl);
  const [contactEmail, setContactEmail] = useState(() => emailCache.get(normalizedBase) || null);

  useEffect(() => {
    if (emailCache.has(normalizedBase)) {
      setContactEmail(emailCache.get(normalizedBase));
      return undefined;
    }

    let isMounted = true;

    if (!emailPromiseCache.has(normalizedBase)) {
      const fetchPromise = fetch(`${normalizedBase}/app-meta/`, {
        credentials: 'include',
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load metadata'))))
        .then((data) => data?.contact_email || null)
        .catch(() => null);

      emailPromiseCache.set(normalizedBase, fetchPromise);
    }

    emailPromiseCache.get(normalizedBase).then((email) => {
      if (!isMounted) return;
      if (email) {
        emailCache.set(normalizedBase, email);
      }
      setContactEmail(email);
    });

    return () => {
      isMounted = false;
    };
  }, [normalizedBase]);

  const emailAddress = contactEmail || FALLBACK_EMAIL;
  const mailHref = `mailto:${emailAddress}`;

  return (
    <footer className="app-footer" aria-label="Application feedback contact">
      <p className="app-footer-text">
        <span>{FOOTER_PREFIX}</span>
        <a href={mailHref}>Contact Service Communications</a>
        <span>{FOOTER_SUFFIX}</span>
      </p>
    </footer>
  );
}

export default AppFooter;
