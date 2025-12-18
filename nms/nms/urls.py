from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static
from DASHBOARD import views as dashboard_views

# Reuse the same app routes under an /api prefix so local dev can hit /api/*
# just like production behind Nginx.
api_patterns = [
    path("", include("USER.urls")),
    path("dashboard/", include("DASHBOARD.urls")),
    path("send-email/", dashboard_views.send_email, name="api_send_email"),
    path("", include("communications.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("USER.urls")),
    path("dashboard/", include("DASHBOARD.urls")),
    path("send-email/", dashboard_views.send_email, name="send_email"),
    path("api/", include(api_patterns)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
