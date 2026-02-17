import logging

from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .models import (
    EmailIngested,
    MailboxConfig,
    MappingRule,
    SDTQueueItem,
    SDTRequest,
    SiteCodeMapping,
)
from .ms_graph import GraphConfigurationError, fetch_message, fetch_messages
from .parsing import parse_email
from .serializers import (
    EmailIngestedDetailSerializer,
    EmailIngestedSerializer,
    LogicMonitorSdtCreateSerializer,
    MailboxConfigSerializer,
    MappingRuleSerializer,
    SDTQueueItemSerializer,
    SDTRequestSerializer,
    SdtLoginSerializer,
    SiteCodeMappingSerializer,
)
from .services import (
    apply_mapping_rules,
    cancel_queue_item,
    create_sdt_request,
    ingest_email_message,
    normalize_graph_message,
    normalize_sdt_input,
    process_queue_tick,
    replay_queue_item,
)

logger = logging.getLogger(__name__)


class LoginView(TokenObtainPairView):
    serializer_class = SdtLoginSerializer
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


class MailboxConfigViewSet(viewsets.ModelViewSet):
    queryset = MailboxConfig.objects.all().order_by("name")
    serializer_class = MailboxConfigSerializer
    permission_classes = [permissions.IsAuthenticated]


class MappingRuleViewSet(viewsets.ModelViewSet):
    queryset = MappingRule.objects.all()
    serializer_class = MappingRuleSerializer
    permission_classes = [permissions.IsAuthenticated]


class SiteCodeMappingViewSet(viewsets.ModelViewSet):
    queryset = SiteCodeMapping.objects.all().order_by("vendor_site_code")
    serializer_class = SiteCodeMappingSerializer
    permission_classes = [permissions.IsAuthenticated]


class SDTQueueViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SDTQueueItem.objects.all().order_by("-created_at")
    serializer_class = SDTQueueItemSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_param = (self.request.query_params.get("status") or "").strip().lower()
        search = (self.request.query_params.get("search") or "").strip()
        if status_param and status_param != "all":
            queryset = queryset.filter(status=status_param)
        if search:
            queryset = queryset.filter(
                Q(maintenance_id__icontains=search)
                | Q(vendor_site_code__icontains=search)
                | Q(lm_site_code__icontains=search)
            )
        return queryset.order_by("-created_at")

    @action(detail=True, methods=["post"], url_path="replay")
    def replay(self, request, pk=None):
        item = self.get_object()
        lm_mapped = bool(item.lm_site_code and str(item.lm_site_code).strip())
        allowed_pending = item.status == SDTQueueItem.Status.PENDING and lm_mapped
        allowed_active = item.status == SDTQueueItem.Status.ACTIVE and bool((item.last_error or "").strip())
        if not (allowed_pending or allowed_active):
            return Response(
                {"detail": "Replay allowed only for Pending+mapped or Active items with errors."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        replay_queue_item(item)
        return Response({"status": "replayed", "id": item.id})

    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        item = self.get_object()
        cancel_queue_item(item, reason="manual cancel")
        return Response({"status": "cancelled", "id": item.id})


class SDTQueueOverviewView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        statuses = [choice[0] for choice in SDTQueueItem.Status.choices]
        counts = {status_name: SDTQueueItem.objects.filter(status=status_name).count() for status_name in statuses}
        mapping_missing = SDTQueueItem.objects.filter(lm_site_code__isnull=True).count() + SDTQueueItem.objects.filter(
            lm_site_code=""
        ).count()
        return Response(
            {
                "counts": counts,
                "mapping_missing": mapping_missing,
                "mapping_guidance": "Site code mapping is updated monthly. Keep mappings current before activation.",
            }
        )


class SchedulerTickView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        result = process_queue_tick()
        return Response(result)


class EmailIngestedViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = EmailIngested.objects.select_related("mailbox", "parse_result", "mapping_result")
        status_param = (self.request.query_params.get("status") or "").strip().lower()
        if status_param and status_param != "all":
            queryset = queryset.filter(status=status_param)
        return queryset.order_by("-received_at", "-created_at")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return EmailIngestedDetailSerializer
        return EmailIngestedSerializer

    @action(detail=False, methods=["post"], url_path="ingest")
    def ingest(self, request):
        payload = request.data or {}
        mailbox_id = payload.get("mailbox_id")
        mailbox = MailboxConfig.objects.filter(id=mailbox_id).first() if mailbox_id else None
        mapping_rules = MappingRule.objects.filter(is_active=True)
        email, parse_result, mapping_result = ingest_email_message(mailbox, payload, mapping_rules)
        return Response(
            {
                "email": EmailIngestedSerializer(email).data if email else None,
                "parse_result": parse_result.id if parse_result else None,
                "mapping_result": mapping_result.id if mapping_result else None,
            },
            status=status.HTTP_201_CREATED,
        )


class EmailReplayView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk=None):
        email = EmailIngested.objects.filter(pk=pk).first()
        if not email:
            return Response({"detail": "Email not found"}, status=status.HTTP_404_NOT_FOUND)
        if hasattr(email, "parse_result"):
            maintenance_id = (email.parse_result.extracted_fields or {}).get("maintenance_id") or ""
            item = SDTQueueItem.objects.filter(maintenance_id=maintenance_id).first()
            if item:
                replay_queue_item(item)
        return Response({"status": "replayed"})


class SDTRequestViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = SDTRequest.objects.select_related("email")
    serializer_class = SDTRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_param = (self.request.query_params.get("status") or "").strip().lower()
        if status_param and status_param != "all":
            queryset = queryset.filter(lm_status=status_param)
        return queryset


class ParserTestView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        payload = request.data or {}
        subject = payload.get("subject") or ""
        body = payload.get("body") or payload.get("body_text") or ""
        sender = payload.get("sender") or ""
        parse_data = parse_email(subject, body, payload.get("body_html") or "")
        mapping_rules = MappingRule.objects.filter(is_active=True)
        mapping_payload = apply_mapping_rules(
            {"subject": subject, "body_text": body, "sender": sender}, mapping_rules
        )
        targets = mapping_payload.get("targets") or []
        preview = {
            "parsed": {
                "title": parse_data.get("title"),
                "start_at": parse_data.get("start_at"),
                "end_at": parse_data.get("end_at"),
                "timezone": parse_data.get("timezone"),
                "notes": parse_data.get("notes"),
                "maintenance_id": (parse_data.get("extracted_fields") or {}).get("maintenance_id"),
                "vendor_site_code": (parse_data.get("extracted_fields") or {}).get("vendor_site_code"),
                "is_cancellation": (parse_data.get("extracted_fields") or {}).get("is_cancellation"),
            },
            "mapped": {
                "targets": targets,
                "matched_rules": mapping_payload.get("matched_rules") or [],
                "mapping_status": mapping_payload.get("mapping_status"),
            },
            "sender": sender,
        }
        return Response(preview)


class LogicMonitorSdtCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = LogicMonitorSdtCreateSerializer(data=request.data or {})
        serializer.is_valid(raise_exception=True)
        try:
            normalized = normalize_sdt_input(serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        correlation_ref = (
            serializer.validated_data.get("email_message_id")
            or serializer.validated_data.get("external_ref")
            or "manual"
        )
        sdt_request, attempted = create_sdt_request(
            correlation_ref=correlation_ref,
            target_type=normalized["target_type"],
            target_id=normalized["target_id"],
            start_ms=normalized["start_ms"],
            end_ms=normalized["end_ms"],
            comment=normalized["comment"],
            email=None,
        )
        return Response(
            {
                "status": sdt_request.lm_status,
                "request_id": sdt_request.id,
                "lm_sdt_id": sdt_request.lm_sdt_id,
                "already_created": not attempted and sdt_request.lm_status == SDTRequest.Status.SUCCESS,
                "error": sdt_request.lm_error,
            },
            status=status.HTTP_201_CREATED,
        )


class HealthView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        def mask(value, visible=4):
            if not value:
                return ""
            value = str(value)
            if len(value) <= visible:
                return "*" * len(value)
            return f"{'*' * (len(value) - visible)}{value[-visible:]}"

        logicmonitor = {
            "account": bool(settings.LOGICMONITOR_ACCOUNT),
            "access_id": mask(settings.LOGICMONITOR_ACCESS_ID),
            "access_key": mask(settings.LOGICMONITOR_ACCESS_KEY),
            "api_base": settings.LOGICMONITOR_API_BASE or "",
            "ingest_mode": settings.EMAIL_INGEST_MODE,
            "poll_interval_seconds": settings.POLL_INTERVAL_SECONDS,
            "mailbox_address": settings.MAILBOX_ADDRESS,
        }
        return Response(
            {
                "status": "ok",
                "timestamp": timezone.now(),
                "logicmonitor": logicmonitor,
            }
        )


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
        mapping_rules = MappingRule.objects.filter(is_active=True)
        processed = 0
        for notice in notifications:
            subscription_id = notice.get("subscriptionId")
            client_state = notice.get("clientState")
            mailbox = MailboxConfig.objects.filter(
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
            ingest_email_message(mailbox, normalized, mapping_rules)
            processed += 1
        return Response({"processed": processed})


class MailboxPollView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk=None):
        mailbox = MailboxConfig.objects.filter(pk=pk).first()
        if not mailbox:
            return Response({"detail": "Mailbox not found"}, status=status.HTTP_404_NOT_FOUND)
        user_id = mailbox.address
        since = mailbox.last_polled_at
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
            try:
                normalized = normalize_graph_message(message)
                ingest_email_message(mailbox, normalized, mapping_rules)
                processed += 1
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Failed to ingest message for %s: %s", mailbox.address, exc)
        mailbox.last_polled_at = timezone.now()
        mailbox.last_sync_at = mailbox.last_polled_at
        mailbox.save(update_fields=["last_polled_at", "last_sync_at"])
        return Response({"processed": processed})
