
---

# 🚀 Production Deployment Guide (Docker + Private/Public IP + HTTPS + Azure SSO)

---

## 1 Upload Project to Server

Copy your project folder or zip to the EC2 instance:

```bash
# Copy folder
scp -i your-key.pem -r /path/to/your/project ec2-user@18.212.236.236:~/service_communication

# Or copy zip
scp -i your-key.pem /path/to/service_communication.zip ec2-user@18.212.236.236:~/
```

Connect to the server:

```bash
ssh -i your-key.pem ec2-user@18.212.236.236
cd ~/
unzip service_communication.zip   # Only if uploaded as zip
cd service_communication
```

> Replace `18.212.236.236` with your **private or public IP** depending on your environment.

---

## 2 Install Docker & Docker Compose (Amazon Linux 2023)

```bash
sudo dnf update -y
sudo dnf install docker -y
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user
```

> Log out and reconnect for Docker group permissions:

```bash
exit
ssh -i your-key.pem ec2-user@18.212.236.236
docker ps
```

Install Docker Compose:

```bash
sudo curl -L "https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

---

## 3 Configure `.env` Files for Production

There are **two `.env` files**:

1. **Backend `.env.prod.be`** → `service_communication/.env.prod.be`
2. **Frontend `.env.prod.fe`** → `service_communication/frontend/.env.prod.fe`

### Backend Example

```env
HOST_URL=https://18.212.236.236       # Use private or public IP
BACKEND_PORT=8000
DEBUG=False
ALLOWED_HOSTS=18.212.236.236,localhost
DJANGO_SECRET_KEY=your-secret-key

# Azure SSO redirect
AZURE_REDIRECT_URI=https://18.212.236.236:8000/oauth2/callback/
```

### Frontend Example

```env
REACT_APP_API_BASE_URL=https://18.212.236.236/api
REACT_APP_SCOPES=openid profile email offline_access User.Read
```

> Replace `18.212.236.236` with your instance’s IP (private or public depending on your setup).
> Ensure the SSL certificate CN matches this IP.

## 4 Build & Run Production Containers

Make the build script executable:

```bash
chmod +x build.sh
./build.sh prod
```

Check logs:

```bash
docker-compose -f docker-compose.prod.yml logs -f --tail=100
```

---

## 5 Access the App

| Component     | URL                                          |
| ------------- | -------------------------------------------- |
| Frontend SPA  | `https://18.212.236.236/`                          |
| Backend Admin | `https://18.212.236.236/admin/login/?next=/admin/` |

> Browser will warn about the **self-signed SSL certificate**.
> Import the `.crt` into your system/browser if you want to remove the warning.

---

## 6 Azure SSO

* **Backend redirect URI**: `https://18.212.236.236/oauth2/callback/`
* **Frontend scopes**: `openid profile email offline_access User.Read`

> Azure must be able to reach the IP — if using a **private IP**, only internal networks or VPN can access it.
> For external access, use a **public IP/domain or tunnel**.

---

## 7 Service Communications Module

The refreshed stack ships a purpose-built incident communications workflow:

* **Authentication** – `/api/auth/login/` issues JWT tokens; `/api/auth/refresh/` refreshes them. All other `/api/*` routes expect a `Bearer` token.
* **Teams & Roles** – `communications.Team` + `TeamMembership` allow User/Team Admin/System Admin roles. System Admins are Django staff/superusers.
* **Distribution Lists** – Global lists (no team) and team-scoped lists (w/ membership checks). Each list stores recipient entries with optional descriptions.
* **Incidents** – Create incidents per team, associate a primary distribution list, and view the full message timeline.
* **Messaging & Attachments** – `/api/messages/` accepts multipart form data, stores attachments, and mails recipients via SMTP.
* **Templates & Closing** – `/api/templates/` exposes the 3 default templates (Major, Incident, Service Announcement). `POST /api/incidents/{id}/close/` captures the final email and marks the incident closed.
* **React Dashboard** – The new dashboard (CRA) uses the JWT APIs for login, incident creation, distribution list management, message timeline, and closure actions.

> Tip: create Django users/teams via the admin, assign memberships, then log in through the SPA to manage communications.

## 8 Service Communications vs. Network Operations modules

* All Service Communications endpoints now live under `/api/service-communications/*`. Network Operations has its own namespace at `/api/network-operations/*`.
* The React SPA can be run as a combined experience (default) or as a single module by setting `REACT_APP_APP_SCOPE=service` or `REACT_APP_APP_SCOPE=network`.
* Each module has distinct routing. Service Communications continues to use `/service-communications`, while the new Network Operations console is mounted at `/network-operations`.
* `REACT_APP_API_BASE_URL` should point to the shared `/api` root (e.g. `https://host/api`). The SPA automatically appends the module path.

## 9 Microsoft Graph distribution lists

* Manual/custom DL creation has been removed. Lists are sourced directly from Microsoft Entra ID via the Graph API and attached to individual incidents without any intermediate “import” step.
* Required environment variables: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. The app requests `Group.Read.All` _and_ `Directory.Read.All` to discover distribution groups by id, email, or display name.
* UI updates:
  * Inline Microsoft 365 search for incident creation and the dedicated "Edit recipients" modal (message composer consumes the stored incident defaults).
  * Users can add optional one-off recipients; selections persist per incident and are re-used for future updates.
  * Editing recipients jumps directly into the editor without extra scrolling; leaving the selection empty when sending/closing reuses the saved defaults.
* Storage/audit rules: only the Graph object id, display name, and email snapshot are stored per incident. Recipient snapshots (including HTML/text bodies) are captured per message, and Microsoft Graph is queried at send time to ensure the DL still exists.

## 10 Email templates

* Templates are now stored in the `EmailTemplate` model and versioned via Django migrations (`communications/migrations/0004` and `0005`).
* `/api/service-communications/templates/` lists available templates. `/api/service-communications/templates/<template_key>/preview/` renders the HTML/text preview given form context.
* Templates can be managed in the Django admin under **Communications → Email templates** for downstream iteration without code changes.

## 11 Local development & Graph requirements

### Backend + frontend

1. Create a virtual environment and install dependencies:

   ```bash
   cd service_communication
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Provide a `.env` file (or export environment variables) with at least:

   ```
   DJANGO_SECRET_KEY=dev-secret
   DEBUG=True
   ALLOWED_HOSTS=localhost,127.0.0.1
   HOST_URL=http://localhost:3000
   AZURE_TENANT_ID=<tenant-id>
   AZURE_CLIENT_ID=<app-id>
   AZURE_CLIENT_SECRET=<client-secret>
   ```

3. Run the database migrations and start the Django API (defaults to port `8000`):

   ```bash
   python manage.py migrate
   python manage.py runserver
   ```

4. Start the React SPA:

   ```bash
   cd frontend
   npm install
   REACT_APP_API_BASE_URL=http://localhost:8000/api \
   REACT_APP_APP_SCOPE=combined \
   npm start
   ```

   `REACT_APP_APP_SCOPE` can be set to `service`, `network`, or `combined` to launch the standalone Service Communications console, Network Operations console, or both modules respectively.

### Microsoft Graph permissions

The Microsoft Graph integration (used for searching and importing distribution lists) requires an Azure AD application with the following delegated/application permissions:

* `Group.Read.All` – to discover mail-enabled security and distribution groups.
* `Directory.Read.All` – to resolve distribution list metadata by id/email before each send.

Configure `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` so the backend can obtain an application token via the client credential flow. No group membership data is persisted; only the Graph object id, name snapshot, and email are stored per distribution list.

### Email template management

Email templates are versioned records in the `EmailTemplate` model and exposed via `/api/service-communications/templates/`. Use the Django admin (**Communications → Email templates**) to add or update HTML/text bodies without redeploying. The helper in `communications/template_loader.py` caches templates per key and automatically invalidates cache entries whenever a template is saved or deleted. Default templates also live in `communications/constants.py` in case the database has not been seeded yet.

## 12 Database & migrations

* Apply the new schema before running the app:

```bash
cd service_communication
source .venv/bin/activate  # or your virtualenv
python manage.py migrate
```

* Key changes:
  * Removed custom DL entry tables, introduced `EmailTemplate`, incident default recipients, and audit snapshot fields.
  * Distribution list routes are read-only; Graph search/import endpoints handle new entries.
