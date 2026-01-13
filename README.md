
---

# 🚀 LogicMonitor Alert Ingestion Deployment Guide (Docker + Private/Public IP + HTTPS + Azure SSO)

---

## 1 Upload Project to Server

Copy your project folder or zip to the EC2 instance:

```bash
# Copy folder
scp -i your-key.pem -r /path/to/your/project ec2-user@18.212.236.236:~/logic_monitor

# Or copy zip
scp -i your-key.pem /path/to/logic_monitor.zip ec2-user@18.212.236.236:~/
```

Connect to the server:

```bash
ssh -i your-key.pem ec2-user@18.212.236.236
cd ~/
unzip logic_monitor.zip   # Only if uploaded as zip
cd logic_monitor
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

1. **Backend `.env.prod.be`** → `logic_monitor/.env.prod.be`
2. **Frontend `.env.prod.fe`** → `logic_monitor/frontend/.env.prod.fe`

### Backend Example

```env
HOST_URL=https://18.212.236.236       # Use private or public IP
BACKEND_PORT=8000
DEBUG=False
ALLOWED_HOSTS=18.212.236.236,localhost
DJANGO_SECRET_KEY=your-secret-key

# Azure SSO redirect
AZURE_REDIRECT_URI=https://18.212.236.236:8000/oauth2/callback/

# Microsoft Graph mailbox ingestion (client credentials)
GRAPH_API_BASE=https://graph.microsoft.com/v1.0
GRAPH_APP_SCOPE=https://graph.microsoft.com/.default

# LogicMonitor
LOGICMONITOR_ACCOUNT=your-account
LOGICMONITOR_ACCESS_ID=your-access-id
LOGICMONITOR_ACCESS_KEY=your-access-key
LOGICMONITOR_API_BASE=
```

### Frontend Example

```env
REACT_APP_API_BASE_URL=https://18.212.236.236/api
REACT_APP_SCOPES=openid profile email offline_access User.Read
REACT_APP_APP_SCOPE=alerts
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

## 7 Alert Ingestion module (LogicMonitor)

The Alert Ingestion module ingests mailbox alerts from Microsoft Graph, parses them into structured events, correlates duplicates, and delivers them to LogicMonitor.

### Core endpoints

All endpoints live under `/api/alert-ingestion/`:

* `/mailboxes/` – manage mailboxes, allowlists, and ingestion mode.
* `/parsers/` – configure parsing rules (regex extraction + normalization maps).
* `/rules/` – configure mapping rules (resource/severity/category overrides).
* `/events/` – correlated alert events (includes `/events/{id}/timeline/` and `/events/{id}/replay/`).
* `/deliveries/` – LogicMonitor delivery attempts.
* `/health/` – health check for the module.
* `/graph/webhook/` – Microsoft Graph subscription webhook.

### Sample payloads

Test parser endpoint:

```bash
curl -X POST https://<host>/api/alert-ingestion/events/test-parse/ \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sender": "alerts@example.com",
    "subject": "ALERT: Router Down",
    "body": "Resource: edge-01\\nAlert: Link Down\\nSeverity: Critical\\nState: OPEN\\nTimestamp: 2024-08-20T10:30:00Z"
  }'
```

Manual ingestion endpoint:

```bash
curl -X POST https://<host>/api/alert-ingestion/events/ingest/ \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "mailbox_id": 1,
    "sender": "alerts@example.com",
    "subject": "ALERT: Router Down",
    "body": "Resource: edge-01\\nAlert: Link Down\\nSeverity: Critical\\nState: OPEN\\nTimestamp: 2024-08-20T10:30:00Z"
  }'
```

### Graph subscription notes

* Register the webhook URL as `https://<host>/api/alert-ingestion/graph/webhook/`.
* Store the subscription id/client state on the Mailbox record to validate notifications.
* Required Graph permissions: `Mail.Read` for the target mailbox and `offline_access` for client credentials.

### LogicMonitor notes

* Configure `LOGICMONITOR_ACCOUNT`, `LOGICMONITOR_ACCESS_ID`, `LOGICMONITOR_ACCESS_KEY`.
* Optionally override `LOGICMONITOR_API_BASE` if your LM tenant uses a custom base URL.
* The delivery payload includes `correlationKey`, `resource`, `alertName`, `severity`, `state`, and `category` fields.

## 8 Local development & Graph requirements

### Backend + frontend

1. Create a virtual environment and install dependencies:

   ```bash
   cd logic_monitor
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
   GRAPH_API_BASE=https://graph.microsoft.com/v1.0
   GRAPH_APP_SCOPE=https://graph.microsoft.com/.default
   LOGICMONITOR_ACCOUNT=<lm-account>
   LOGICMONITOR_ACCESS_ID=<lm-access-id>
   LOGICMONITOR_ACCESS_KEY=<lm-access-key>
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
   REACT_APP_APP_SCOPE=alerts \
   npm start
   ```

   `REACT_APP_APP_SCOPE` can be set to `alerts` (default) or `network` if you also keep the Network Operations console.

### Microsoft Graph permissions

The Microsoft Graph integration requires an Azure AD application with `Mail.Read` permissions for the mailbox and client credential access via `GRAPH_APP_SCOPE=https://graph.microsoft.com/.default`.

## 9 Database & migrations

* Apply the new schema before running the app:

```bash
cd logic_monitor
source .venv/bin/activate  # or your virtualenv
python manage.py migrate
```

* Apply the migrations before running the app in any environment.
