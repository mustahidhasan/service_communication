from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

network_operations_patterns = [
    path("", include("network_ops.urls")),
]

alert_ingestion_patterns = [
    path("", include("alert_ingestion.urls")),
]

sdt_automation_patterns = [
    path("", include("sdt_automation.urls")),
]

# Reuse the same app routes under an /api prefix so local dev can hit /api/*
# just like production behind Nginx.
api_patterns = [
    path("", include("USER.urls")),
    path("network-operations/", include(network_operations_patterns)),
    path("alert-ingestion/", include(alert_ingestion_patterns)),
    path("sdt-automation/", include(sdt_automation_patterns)),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("USER.urls")),
    path("api/", include(api_patterns)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
