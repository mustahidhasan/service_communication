from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MailboxConfigViewSet,
    MappingRuleViewSet,
    SiteCodeMappingViewSet,
    SDTQueueViewSet,
    SDTQueueOverviewView,
    SchedulerTickView,
    EmailIngestedViewSet,
    SDTRequestViewSet,
    ParserTestView,
    HealthView,
    GraphWebhookView,
    MailboxPollView,
    LoginView,
    RefreshView,
    SessionLoginView,
)

router = DefaultRouter()
router.register(r"mailboxes", MailboxConfigViewSet, basename="mailbox")
router.register(r"rules", MappingRuleViewSet, basename="rule")
router.register(r"site-mappings", SiteCodeMappingViewSet, basename="site-mapping")
router.register(r"queue", SDTQueueViewSet, basename="queue")
router.register(r"emails", EmailIngestedViewSet, basename="email")
router.register(r"sdt-requests", SDTRequestViewSet, basename="sdt-request")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="api-login"),
    path("auth/refresh/", RefreshView.as_view(), name="api-refresh"),
    path("auth/session-login/", SessionLoginView.as_view(), name="session-login"),
    path("health/", HealthView.as_view(), name="health"),
    path("queue/overview/", SDTQueueOverviewView.as_view(), name="queue-overview"),
    path("scheduler/tick/", SchedulerTickView.as_view(), name="scheduler-tick"),
    path("graph/webhook/", GraphWebhookView.as_view(), name="graph-webhook"),
    path("mailboxes/<int:pk>/poll/", MailboxPollView.as_view(), name="mailbox-poll"),
    path("parser/test/", ParserTestView.as_view(), name="parser-test"),
    path("", include(router.urls)),
]
