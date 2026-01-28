from django.urls import path

from .views import LogicMonitorSdtCreateView

urlpatterns = [
    path("sdts/", LogicMonitorSdtCreateView.as_view(), name="logicmonitor-sdt-create"),
]
