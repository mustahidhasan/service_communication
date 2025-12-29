import './Guide.css';

const Guide = () => {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const guideUrl = baseUrl ? `${baseUrl}/guide` : '/guide';
  const appUrl = baseUrl ? `${baseUrl}/service-communications` : '/service-communications';

  return (
    <div className="app-shell guide-shell">
      <header className="app-header guide-header">
        <div className="guide-branding">
          <img src="/logo_left.png" alt="Service Communications" className="guide-logo" />
          <div>
            <p className="guide-kicker">Service Communications</p>
            <h1>User Guide</h1>
            <p className="guide-subtitle">Step-by-step workflow for teams, incidents, and email updates</p>
          </div>
        </div>
        <div className="guide-header-actions">
          <a className="guide-link" href={appUrl} target="_blank" rel="noreferrer">
            Open App
          </a>
        </div>
      </header>

      <section className="guide-hero">
        <div className="guide-hero-content">
          <p className="guide-pill">Live guide</p>
          <h2>Everything you need to run Service Communications</h2>
          <p>
            This guide matches the UI in this project. It explains how to create teams, start
            incidents, send updates, and close incidents using Microsoft 365 distribution lists.
          </p>
          <div className="guide-hero-links">
            <div>
              <span>Guide URL</span>
              <a href={guideUrl}>{guideUrl}</a>
            </div>
            <div>
              <span>App URL</span>
              <a href={appUrl}>{appUrl}</a>
            </div>
          </div>
        </div>
        <div className="guide-hero-card">
          <h3>Quick start</h3>
          <ol>
            <li>Log in and select a team from the top Team filter.</li>
            <li>Use Create Incident to capture the incident details.</li>
            <li>Open Email Timeline to send updates and view history.</li>
            <li>Close Incident & Notify to finish the workflow.</li>
          </ol>
        </div>
      </section>

      <section className="guide-grid">
        <article className="guide-card">
          <h3>1) Set up a distribution list in Microsoft 365</h3>
          <ol>
            <li>Open Microsoft 365 admin center.</li>
            <li>Go to Teams & groups → Active teams & groups → Add a group.</li>
            <li>Choose Distribution (or Mail-enabled security if you need permissions).</li>
            <li>Fill name, email address, owners, and members.</li>
            <li>Save, then wait a minute for directory sync.</li>
          </ol>
          <p className="guide-note">
            This app only reads lists from Microsoft Entra ID. It does not create lists inside the app.
          </p>
        </article>

        <article className="guide-card">
          <h3>2) Add contacts or new emails</h3>
          <ol>
            <li>For a reusable group, create a Microsoft 365 distribution list (step 1).</li>
            <li>
              To add individual email contacts, use Microsoft 365 admin center → Users → Contacts → Add a
              contact (or Outlook People → New contact).
            </li>
            <li>For one-off recipients, use the One-off Recipients field in the app.</li>
            <li>Use comma or newline separated emails in One-off Recipients.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>3) Create teams in Service Communications</h3>
          <ol>
            <li>Open the Teams tab.</li>
            <li>Fill Team Name and Description.</li>
            <li>Click Save Team.</li>
            <li>Use the Select Team dropdown to activate your team.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>4) Create an incident</h3>
          <ol>
            <li>Select a team from the top Team dropdown.</li>
            <li>Open the Create Incident tab.</li>
            <li>Fill required fields: INC Number, Subject, Incident Type, Problem Description, Workaround.</li>
            <li>Pick Next Communication Time and select a Template.</li>
            <li>Search for Distribution Lists and click Add.</li>
            <li>Optional: add Impact, Affected Regions, and One-off Recipients.</li>
            <li>Click Save Incident.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>5) Search and add saved distribution lists</h3>
          <ol>
            <li>
              In Create Incident, search in Distribution Lists (example: <strong>Service_Communication_Alerts</strong>{' '}
              or <strong>ops-alerts@company.com</strong>) and click Add.
            </li>
            <li>To edit later, open Email Timeline and click Edit recipients.</li>
            <li>Search again, Add lists, then Save recipients.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>6) Send email and use templates</h3>
          <ol>
            <li>Go to All Incidents and select an incident.</li>
            <li>Click Open Email Timeline.</li>
            <li>Select a Template and review the Template Preview.</li>
            <li>Click Use template to auto-fill the subject/body.</li>
            <li>Confirm recipients, POC, and optional overrides.</li>
            <li>Add attachments if needed, then click Send Email.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>7) Manage the email timeline</h3>
          <ol>
            <li>Open Email Timeline for the incident.</li>
            <li>The timeline shows each message with timestamp and recipients.</li>
            <li>Use the form at the top to send the next update.</li>
            <li>Next Communication time is updated per message.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>8) Close incidents</h3>
          <ol>
            <li>Select the incident in All Incidents.</li>
            <li>Click Close Incident.</li>
            <li>Fill Final Subject and Final Message Body.</li>
            <li>Choose distribution lists or leave empty to use defaults.</li>
            <li>Add Point of Contact and email.</li>
            <li>Click Close Incident & Notify.</li>
          </ol>
        </article>
      </section>

      <section className="guide-footer">
        <div>
          <h3>Need admin changes?</h3>
          <p>
            If you cannot see a distribution list, confirm the Microsoft 365 group exists and the
            Azure Graph permissions are configured for this deployment.
          </p>
        </div>
        <div className="guide-footer-meta">
          <span>Service Communications</span>
          <span>Guide version: 1.0</span>
        </div>
      </section>
    </div>
  );
};

export default Guide;
