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
          <h3>1) Server setup (production)</h3>
          <ol>
            <li>Upload the project to the server and SSH into the instance.</li>
            <li>Install Docker + Docker Compose (Amazon Linux 2023 instructions in README).</li>
            <li>Configure backend `.env.prod.be` and frontend `.env.prod.fe`.</li>
            <li>Run `./build.sh prod` to build and start the containers.</li>
            <li>Open `https://&lt;server-ip&gt;/` for the frontend and `/admin/` for Django admin.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>1.1) SSL cert location</h3>
          <p>
            The SSL certs must live in `service_communication/certs` as `server.crt` and `server.key`.
            Docker mounts this directory into the frontend container at `/etc/ssl/private` (see
            `docker-compose.prod.yml`). If you move the certs, update the mount path or Nginx config.
          </p>
        </article>

        <article className="guide-card">
          <h3>1.2) Azure SSO setup</h3>
          <ol>
            <li>
              Open the Azure portal:{' '}
              <a
                href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/"
                target="_blank"
                rel="noreferrer"
              >
                https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/
              </a>
            </li>
            <li>Go to Registered apps.</li>
            <li>Select the application.</li>
            <li>Get tenant and client IDs from Overview.</li>
            <li>Set the callback URL under Authentication.</li>
            <li>Get the client secret under Certificates & secrets.</li>
            <li>Set Group permissions under API permissions for 365 additions.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>1.2.1) Azure SSO credentials (current)</h3>
          <pre className="guide-code">
{`AZURE_TENANT_ID=05ceb559-e89f-4e43-a141-34567baa8838
AZURE_CLIENT_ID=2674c689-eca2-4af7-8a21-02a6fccbc04d
AZURE_CLIENT_SECRET=KER8Q~wLpPH~LyHaCKQNuY7cPQ46xSMbVAQ~UdoU`}
          </pre>
          <p className="guide-note">
            This SSO is configured in the project `.env` files for account
            <strong> user1@IrisInnovations.onmicrosoft.com</strong> (password:
            <strong> ***********</strong>). If you switch Azure SSO / 365 service to another
            account, update these credentials in the `.env` files and rebuild the project.
          </p>
        </article>

        <article className="guide-card">
          <h3>1.2.2) Production .env values</h3>
          <p>
            Backend: <code>service_communication/.env.prod.be</code>
          </p>
          <pre className="guide-code">
{`HOST_URL=https://<server-ip>
BACKEND_PORT=8000
DEBUG=False
ALLOWED_HOSTS=<server-ip>,localhost
DJANGO_SECRET_KEY=<secret>
AZURE_REDIRECT_URI=https://<server-ip>:8000/oauth2/callback/`}
          </pre>
          <p>
            Frontend: <code>service_communication/frontend/.env.prod.fe</code>
          </p>
          <pre className="guide-code">
{`REACT_APP_API_BASE_URL=https://<server-ip>/api
REACT_APP_SCOPES=openid profile email offline_access User.Read`}
          </pre>
        </article>

        <article className="guide-card">
          <h3>1.3) Microsoft 365 groups & contact</h3>
          <ol>
            <li>Use Microsoft 365 groups (distribution list or mail-enabled security) for reusable recipients.</li>
            <li>Use Microsoft 365 admin center → Users → Contact to add individual contact emails.</li>
            <li>Use One-off Recipients for temporary addresses (comma or newline separated).</li>
          </ol>
          <p className="guide-note">
            Admin portal:{' '}
            <a href="https://admin.exchange.microsoft.com/#/" target="_blank" rel="noreferrer">
              https://admin.exchange.microsoft.com/#/
            </a>
          </p>
        </article>

        <article className="guide-card">
          <h3>2) Set up a distribution list in Microsoft 365</h3>
          <ol>
            <li>Open Microsoft 365 admin center.</li>
            <li>Go to Groups → Add a group.</li>
            <li>Choose Distribution (or Mail-enabled security if you need permissions).</li>
            <li>Fill name, email address, owners, and members.</li>
            <li>Save, then wait a minute for directory sync.</li>
          </ol>
          <p className="guide-note">
            This app only reads lists from Microsoft Entra ID. It does not create lists inside the app.
          </p>
        </article>

        <article className="guide-card">
          <h3>3) Add contacts or new emails</h3>
          <ol>
            <li>For a reusable group, create a Microsoft 365 distribution list (step 1).</li>
            <li>
              To add individual email contacts, use Microsoft 365 admin center → Users → Contacts → Add a
              contact (or Outlook People → New contact).
            </li>
            <li>For one-off recipients, use the One-off Recipients field in the app.</li>
            <li>Use comma or newline separated emails in One-off Recipients.</li>
          </ol>
          <p className="guide-note">
            The app only queries Microsoft Entra ID groups and stored contacts. It does not create
            new Microsoft 365 groups or contacts from inside the UI.
          </p>
        </article>

        <article className="guide-card">
          <h3>4) Create teams in Service Communications</h3>
          <ol>
            <li>Open the Teams tab.</li>
            <li>Fill Team Name and Description.</li>
            <li>Click Save Team.</li>
            <li>Use the Select Team dropdown to activate your team.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>5) Create an incident</h3>
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
          <h3>6) Search and add saved distribution lists</h3>
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
          <h3>7) Send email and use templates</h3>
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
          <h3>8) Manage the email timeline</h3>
          <ol>
            <li>Open Email Timeline for the incident.</li>
            <li>The timeline shows each message with timestamp and recipients.</li>
            <li>Use the form at the top to send the next update.</li>
            <li>Next Communication time is updated per message.</li>
          </ol>
        </article>

        <article className="guide-card">
          <h3>9) Close incidents</h3>
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
