from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

service_communications_patterns = [
    path("", include("communications.urls")),
]

network_operations_patterns = [
    path("", include("network_ops.urls")),
]

# Reuse the same app routes under an /api prefix so local dev can hit /api/*
# just like production behind Nginx.
api_patterns = [
    path("", include("USER.urls")),
    path("service-communications/", include(service_communications_patterns)),
    path("network-operations/", include(network_operations_patterns)),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("USER.urls")),
    path("api/", include(api_patterns)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
