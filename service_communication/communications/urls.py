from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    TeamViewSet,
    IncidentViewSet,
    IncidentMessageViewSet,
    TemplatesView,
    TemplatePreviewView,
    DashboardSummaryView,
    LoginView,
    RefreshView,
    SessionLoginView,
    DirectoryDistributionListView,
)

router = DefaultRouter()
router.register(r"teams", TeamViewSet, basename="team")
router.register(r"incidents", IncidentViewSet, basename="incident")
router.register(r"messages", IncidentMessageViewSet, basename="incident-message")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="api-login"),
    path("auth/refresh/", RefreshView.as_view(), name="api-refresh"),
    path("auth/session-login/", SessionLoginView.as_view(), name="session-login"),
    path("templates/", TemplatesView.as_view(), name="templates"),
    path(
        "templates/<str:template_key>/preview/",
        TemplatePreviewView.as_view(),
        name="template-preview",
    ),
    path("dashboard/summary/", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path(
        "directory/distribution-lists/",
        DirectoryDistributionListView.as_view(),
        name="directory-distribution-lists",
    ),
    path("", include(router.urls)),
]
