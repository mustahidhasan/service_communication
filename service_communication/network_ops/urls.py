from django.urls import path

from .views import NetworkOpsStatusView

app_name = "network_ops"

urlpatterns = [
    path("status/", NetworkOpsStatusView.as_view(), name="status"),
]
