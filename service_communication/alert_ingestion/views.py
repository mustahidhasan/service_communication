import logging
from django.db.models import Count
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Mailbox, ParsingRule, MappingRule, AlertEvent, AlertEmail, DeliveryAttempt
from .serializers import (
    MailboxSerializer,
    ParsingRuleSerializer,
    MappingRuleSerializer,
    AlertEventSerializer,
    AlertEventDetailSerializer,
    AlertEmailSerializer,
    DeliveryAttemptSerializer,
    AlertLoginSerializer,
)
from .services import ingest_email_message, normalize_graph_message
from .parsing import apply_parsing_rules, apply_mapping_rules
from .ms_graph import fetch_message, fetch_messages, GraphConfigurationError

logger = logging.getLogger(__name__)


class LoginView(TokenObtainPairView):
    serializer_class = AlertLoginSerializer
    permission_classes = [permissions.AllowAny]


class RefreshView(TokenRefreshView):
    permission_classes = [permissions.AllowAny]


class SessionLoginView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        refresh = RefreshToken.for_user(request.user)
        data = {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": {
                "username": request.user.username,
                "email": request.user.email,
                "first_name": request.user.first_name,
                "last_name": request.user.last_name,
            },
        }
        return Response(data)


class MailboxViewSet(viewsets.ModelViewSet):
    queryset = Mailbox.objects.all().order_by("name")
    serializer_class = MailboxSerializer
    permission_classes = [permissions.IsAuthenticated]


class ParsingRuleViewSet(viewsets.ModelViewSet):
    queryset = ParsingRule.objects.all()
    serializer_class = ParsingRuleSerializer
    permission_classes = [permissions.IsAuthenticated]


class MappingRuleViewSet(viewsets.ModelViewSet):
    queryset = MappingRule.objects.all()
    serializer_class = MappingRuleSerializer
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=["post"], url_path="test")
    def test_rule(self, request):
        payload = request.data or {}
        sample = {
            "sender": payload.get("sender") or "",
            "subject": payload.get("subject") or "",
            "body": payload.get("body") or "",
            "headers": payload.get("headers") or {},
        }
        parsed = apply_parsing_rules(sample, ParsingRule.objects.filter(is_active=True))
        mapped = apply_mapping_rules(sample, parsed, MappingRule.objects.filter(is_active=True))
        return Response(
            {
                "parsed": {
                    "resource": parsed.get("resource"),
                    "alert_name": parsed.get("alert_name"),
                    "severity": parsed.get("severity"),
                    "normalized_severity": parsed.get("normalized_severity"),
                    "state": parsed.get("state"),
                    "normalized_state": parsed.get("normalized_state"),
                    "timestamp": parsed.get("timestamp"),
                    "matched_rule": parsed.get("matched_rule").id if parsed.get("matched_rule") else None,
                },
                "mapped": {
                    "resource_identifier": mapped.get("resource_identifier"),
                    "alert_name": mapped.get("alert_name"),
                    "severity": mapped.get("severity"),
                    "alert_category": mapped.get("alert_category"),
                    "source_system": mapped.get("source_system"),
                    "matched_rule": mapped.get("matched_rule").id if mapped.get("matched_rule") else None,
                },
            }
        )


class AlertEventViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = (
            AlertEvent.objects.select_related("mailbox", "last_email", "matched_parser_rule", "matched_mapping_rule")
            .annotate(emails_count=Count("emails"), deliveries_count=Count("deliveries"))
            .order_by("-last_seen_at")
        )
        status_param = (self.request.query_params.get("status") or "").strip().lower()
        if status_param and status_param != "all":
            queryset = queryset.filter(status=status_param)
        return queryset

    def get_serializer_class(self):
        if self.action in ("retrieve", "timeline"):
            return AlertEventDetailSerializer
        return AlertEventSerializer

    @action(detail=True, methods=["get"], url_path="timeline")
    def timeline(self, request, pk=None):
        event = self.get_object()
        emails = AlertEmailSerializer(event.emails.order_by("-created_at"), many=True).data
        deliveries = DeliveryAttemptSerializer(event.deliveries.order_by("-created_at"), many=True).data
        return Response({"emails": emails, "deliveries": deliveries})

    @action(detail=True, methods=["post"], url_path="replay")
    def replay(self, request, pk=None):
        event = self.get_object()
        from .services import deliver_event_to_logicmonitor

        attempt = deliver_event_to_logicmonitor(event, event.last_email)
        payload = DeliveryAttemptSerializer(attempt).data if attempt else None
        return Response({"delivery": payload})

    @action(detail=False, methods=["post"], url_path="ingest")
    def ingest(self, request):
        payload = request.data or {}
        mailbox_id = payload.get("mailbox_id")
        mailbox = Mailbox.objects.filter(id=mailbox_id).first() if mailbox_id else None
        parser_rules = ParsingRule.objects.filter(is_active=True)
        mapping_rules = MappingRule.objects.filter(is_active=True)
        event, email = ingest_email_message(mailbox, payload, parser_rules, mapping_rules)
        return Response(
            {
                "event": AlertEventSerializer(event).data if event else None,
                "email": AlertEmailSerializer(email).data if email else None,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="test-parse")
    def test_parse(self, request):
        payload = request.data or {}
        parser_rules = ParsingRule.objects.filter(is_active=True)
        mapping_rules = MappingRule.objects.filter(is_active=True)
        parsed = apply_parsing_rules(payload, parser_rules)
        mapped = apply_mapping_rules(payload, parsed, mapping_rules)
        return Response(
            {
                "parsed": {
                    "resource": parsed.get("resource"),
                    "alert_name": parsed.get("alert_name"),
                    "severity": parsed.get("severity"),
                    "normalized_severity": parsed.get("normalized_severity"),
                    "state": parsed.get("state"),
                    "normalized_state": parsed.get("normalized_state"),
                    "timestamp": parsed.get("timestamp"),
                },
                "mapped": {
                    "resource_identifier": mapped.get("resource_identifier"),
                    "alert_name": mapped.get("alert_name"),
                    "severity": mapped.get("severity"),
                    "alert_category": mapped.get("alert_category"),
                    "source_system": mapped.get("source_system"),
                },
            }
        )


class AlertEmailViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AlertEmail.objects.select_related("mailbox", "event")
    serializer_class = AlertEmailSerializer
    permission_classes = [permissions.IsAuthenticated]


class DeliveryAttemptViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = DeliveryAttempt.objects.select_related("event", "email")
    serializer_class = DeliveryAttemptSerializer
    permission_classes = [permissions.IsAuthenticated]


class HealthView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"status": "ok", "timestamp": timezone.now()})


class GraphWebhookView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        token = request.query_params.get("validationToken")
        if token:
            return HttpResponse(token, content_type="text/plain")
        return Response({"detail": "Missing validation token."}, status=status.HTTP_400_BAD_REQUEST)

    def post(self, request):
        token = request.query_params.get("validationToken")
        if token:
            return HttpResponse(token, content_type="text/plain")
        payload = request.data or {}
        notifications = payload.get("value") or []
        parser_rules = ParsingRule.objects.filter(is_active=True)
        mapping_rules = MappingRule.objects.filter(is_active=True)
        processed = 0
        for notice in notifications:
            subscription_id = notice.get("subscriptionId")
            client_state = notice.get("clientState")
            mailbox = Mailbox.objects.filter(
                graph_subscription_id=subscription_id, graph_subscription_secret=client_state
            ).first()
            if not mailbox:
                continue
            resource = notice.get("resource") or ""
            parts = resource.split("/")
            try:
                user_index = parts.index("users") + 1
                message_index = parts.index("messages") + 1
            except ValueError:
                continue
            if user_index >= len(parts) or message_index >= len(parts):
                continue
            user_id = parts[user_index]
            message_id = parts[message_index]
            try:
                graph_message = fetch_message(user_id, message_id)
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Failed to fetch Graph message: %s", exc)
                continue
            normalized = normalize_graph_message(graph_message)
            ingest_email_message(mailbox, normalized, parser_rules, mapping_rules)
            processed += 1
        return Response({"processed": processed})


class MailboxPollView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk=None):
        mailbox = Mailbox.objects.filter(pk=pk).first()
        if not mailbox:
            return Response({"detail": "Mailbox not found"}, status=status.HTTP_404_NOT_FOUND)
        user_id = mailbox.address
        since = mailbox.last_polled_at
        parser_rules = ParsingRule.objects.filter(is_active=True)
        mapping_rules = MappingRule.objects.filter(is_active=True)
        try:
            messages = fetch_messages(user_id, since=since.isoformat() if since else None)
        except GraphConfigurationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Graph polling failed: %s", exc)
            return Response({"detail": "Unable to poll Graph mailbox."}, status=status.HTTP_502_BAD_GATEWAY)
        processed = 0
        for message in messages:
            normalized = normalize_graph_message(message)
            ingest_email_message(mailbox, normalized, parser_rules, mapping_rules)
            processed += 1
        mailbox.last_polled_at = timezone.now()
        mailbox.last_sync_at = mailbox.last_polled_at
        mailbox.save(update_fields=["last_polled_at", "last_sync_at"])
        return Response({"processed": processed})
