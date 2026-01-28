# Backend (development)
HOST_URL=http://localhost:3000
BACKEND_PORT=8000
DJANGO_SECRET_KEY=dev-secret-key
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,backend,backend-dev,service_communication-backend-dev

# Azure SSO (replace with valid dev credentials)
AZURE_TENANT_ID=05ceb559-e89f-4e43-a141-34567baa8838
AZURE_CLIENT_ID=2674c689-eca2-4af7-8a21-02a6fccbc04d
AZURE_CLIENT_SECRET=KER8Q~wLpPH~LyHaCKQNuY7cPQ46xSMbVAQ~UdoU

# Redirect URIs for local development
AZURE_REDIRECT_URI=http://localhost:3000/oauth2/callback/
POST_LOGOUT_REDIRECT_URI=http://localhost:3000/

# CORS / CSRF for local frontend
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
CORS_ALLOW_CREDENTIALS=True

# Scopes shared with the frontend build
REACT_APP_SCOPES=openid profile email offline_access User.Read

# Email (development)
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=girish.lc.photos2@gmail.com
EMAIL_HOST_PASSWORD=jhazpenfiuhduvvx
DEFAULT_FROM_EMAIL=girish.lc.photos2@gmail.com

# SDT ingestion
MAILBOX_ADDRESS=maintenance@example.com
EMAIL_INGEST_MODE=poll
POLL_INTERVAL_SECONDS=300
ALLOWED_SENDER_DOMAINS=vendor.example.com,alerts.example.com
LOGICMONITOR_ACCOUNT=your-account
LOGICMONITOR_ACCESS_ID=your-access-id
LOGICMONITOR_ACCESS_KEY=your-access-key
LOGICMONITOR_API_BASE=https://your-account.logicmonitor.com/santaba/rest
