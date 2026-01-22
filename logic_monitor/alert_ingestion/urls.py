from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MailboxViewSet,
    ParsingRuleViewSet,
    MappingRuleViewSet,
    AlertEventViewSet,
    AlertEmailViewSet,
    DeliveryAttemptViewSet,
    HealthView,
    GraphWebhookView,
    MailboxPollView,
    LoginView,
    RefreshView,
    SessionLoginView,
)

router = DefaultRouter()
router.register(r"mailboxes", MailboxViewSet, basename="mailbox")
router.register(r"parsers", ParsingRuleViewSet, basename="parser")
router.register(r"rules", MappingRuleViewSet, basename="rule")
router.register(r"events", AlertEventViewSet, basename="event")
router.register(r"emails", AlertEmailViewSet, basename="email")
router.register(r"deliveries", DeliveryAttemptViewSet, basename="delivery")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="api-login"),
    path("auth/refresh/", RefreshView.as_view(), name="api-refresh"),
    path("auth/session-login/", SessionLoginView.as_view(), name="session-login"),
    path("health/", HealthView.as_view(), name="health"),
    path("graph/webhook/", GraphWebhookView.as_view(), name="graph-webhook"),
    path("mailboxes/<int:pk>/poll/", MailboxPollView.as_view(), name="mailbox-poll"),
    path("", include(router.urls)),
]
