import logging
from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import MailboxConfig, MappingRule, EmailIngested, SDTRequest, MappingResult
from .serializers import (
    MailboxConfigSerializer,
    MappingRuleSerializer,
    EmailIngestedSerializer,
    EmailIngestedDetailSerializer,
    SDTRequestSerializer,
    SdtLoginSerializer,
)
from .services import (
    ingest_email_message,
    normalize_graph_message,
    reprocess_email,
    create_sdt_for_email,
    apply_mapping_rules,
)
from .parsing import parse_email
from .ms_graph import fetch_message, fetch_messages, GraphConfigurationError

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

    @action(detail=True, methods=["post"], url_path="replay")
    def replay(self, request, pk=None):
        email = self.get_object()
        mapping_rules = MappingRule.objects.filter(is_active=True)
        reprocess_email(email, mapping_rules)
        return Response({"status": "reprocessed"})

    @action(detail=True, methods=["post"], url_path="ignore")
    def ignore(self, request, pk=None):
        email = self.get_object()
        email.status = EmailIngested.Status.IGNORED
        email.status_detail = "Marked ignored by admin"
        email.save(update_fields=["status", "status_detail"])
        return Response({"status": "ignored"})

    @action(detail=True, methods=["patch"], url_path="mapping")
    def update_mapping(self, request, pk=None):
        email = self.get_object()
        payload = request.data or {}
        targets = payload.get("targets") or []
        target_type = payload.get("target_type") or "device"
        normalized_targets = []
        if isinstance(targets, str):
            targets = [entry.strip() for entry in targets.split(",") if entry.strip()]
        for entry in targets:
            if isinstance(entry, dict):
                identifier = entry.get("identifier")
                entry_type = entry.get("type") or target_type
            else:
                identifier = str(entry)
                entry_type = target_type
            if identifier:
                normalized_targets.append({"identifier": identifier, "type": entry_type})

        mapping_result, _ = MappingResult.objects.update_or_create(
            email=email,
            defaults={
                "targets": normalized_targets,
                "matched_rules": [{"id": "manual", "name": "Manual mapping"}],
                "mapping_status": MappingResult.Status.MAPPED if normalized_targets else MappingResult.Status.NEEDS_MAPPING,
                "mapping_error": "",
            },
        )

        if normalized_targets and email.parse_result and email.parse_result.start_at:
            sdt_request, _ = create_sdt_for_email(email, email.parse_result, mapping_result.targets)
            if sdt_request.lm_status == SDTRequest.Status.SUCCESS:
                email.status = EmailIngested.Status.SDT_CREATED
                email.status_detail = "SDT created from manual mapping"
            else:
                email.status = EmailIngested.Status.FAILED
                email.status_detail = sdt_request.lm_error or "SDT creation failed"
            email.save(update_fields=["status", "status_detail"])
        else:
            email.status = EmailIngested.Status.NEEDS_MAPPING
            email.status_detail = "Target mapping required"
            email.save(update_fields=["status", "status_detail"])

        return Response({"status": "updated"})

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
            },
            "mapped": {
                "targets": targets,
                "matched_rules": mapping_payload.get("matched_rules") or [],
                "mapping_status": mapping_payload.get("mapping_status"),
            },
            "would_create_sdt": bool(parse_data.get("start_at") and parse_data.get("end_at") and targets),
            "sender": sender,
        }
        return Response(preview)


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
