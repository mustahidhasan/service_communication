from pathlib import Path
import os
from datetime import timedelta
from decouple import config

BASE_DIR = Path(__file__).resolve().parent.parent

# Security
SECRET_KEY = config("DJANGO_SECRET_KEY", default="fallback_secret")
DEBUG = config("DEBUG", default=True, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="*").split(",")

# Installed apps
INSTALLED_APPS = [
    "corsheaders",
    "jazzmin",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "USER",
    "network_ops",
    "alert_ingestion",
]

# Middleware
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# URLs and templates
ROOT_URLCONF = "logic_monitor.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "logic_monitor.wsgi.application"

# Database (SQLite for now)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = "/static-django/"
STATIC_ROOT = os.path.join(BASE_DIR, "staticfiles")
STATICFILES_DIRS = []
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Frontend URL
HOST_URL = config("HOST_URL", default="http://localhost")
# FRONTEND_PORT = config("FRONTEND_PORT", default="3000")
FRONTEND_URL = f"{HOST_URL}"

# Azure AD OAuth2
AZURE_TENANT_ID = config("AZURE_TENANT_ID", default="")
AZURE_CLIENT_ID = config("AZURE_CLIENT_ID", default="")
AZURE_CLIENT_SECRET = config("AZURE_CLIENT_SECRET", default="")
AZURE_REDIRECT_URI = config("AZURE_REDIRECT_URI", default=f"{HOST_URL}/oauth2/callback/")
POST_LOGOUT_REDIRECT_URI = config("POST_LOGOUT_REDIRECT_URI", default=HOST_URL)

AZURE_AUTHORITY = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}"
AZURE_AUTHORIZE_ENDPOINT = f"{AZURE_AUTHORITY}/oauth2/v2.0/authorize"
AZURE_TOKEN_ENDPOINT = f"{AZURE_AUTHORITY}/oauth2/v2.0/token"
AZURE_SCOPES = config("REACT_APP_SCOPES", default="openid profile email offline_access User.Read")

# Microsoft Graph (mailbox ingestion)
GRAPH_API_BASE = config("GRAPH_API_BASE", default="https://graph.microsoft.com/v1.0")
GRAPH_APP_SCOPE = config("GRAPH_APP_SCOPE", default="https://graph.microsoft.com/.default")

# LogicMonitor integration
LOGICMONITOR_ACCOUNT = config("LOGICMONITOR_ACCOUNT", default="")
LOGICMONITOR_ACCESS_ID = config("LOGICMONITOR_ACCESS_ID", default="")
LOGICMONITOR_ACCESS_KEY = config("LOGICMONITOR_ACCESS_KEY", default="")
LOGICMONITOR_API_BASE = config("LOGICMONITOR_API_BASE", default="")

# CORS and CSRF
CORS_ALLOWED_ORIGINS = config("CORS_ALLOWED_ORIGINS", default=FRONTEND_URL).split(",")
CSRF_TRUSTED_ORIGINS = config("CSRF_TRUSTED_ORIGINS", default=FRONTEND_URL).split(",")
CORS_ALLOW_CREDENTIALS = True

# Email configuration
EMAIL_BACKEND = config("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = config("EMAIL_HOST", default="")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default=EMAIL_HOST_USER or "no-reply@example.com")

# Media files for attachments
MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DIR, "media")

# Django REST Framework
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}
