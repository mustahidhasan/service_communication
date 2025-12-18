# Backend (development)
HOST_URL=http://localhost:3000
BACKEND_PORT=8000
DJANGO_SECRET_KEY=dev-secret-key
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,backend,backend-dev,nms-backend-dev

# Azure SSO (replace with valid dev credentials)
AZURE_TENANT_ID=20873f24-587c-427a-8b39-20b75349b61d
AZURE_CLIENT_ID=f682b7c8-8047-4b0b-91de-f6735855f32d
AZURE_CLIENT_SECRET=e1~8Q~6pHm06y1Zoeu2t6U2b0ICe_rVF2WSMYaaQ

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
