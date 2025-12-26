import logging
import requests

from django.db.models import Q, Count
from django.utils import timezone
from rest_framework import viewsets, permissions, status, mixins
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Team, TeamMembership, Incident, IncidentMessage, EmailTemplate
from .serializers import (
    TeamSerializer,
    IncidentSerializer,
    IncidentMessageSerializer,
    AnnouncementTemplateSerializer,
    IncidentCloseSerializer,
    LoginSerializer,
)
from USER.models import UserRole, get_user_role, user_is_global_team_admin, user_is_system_admin

from .permissions import user_can_manage_team, user_in_team
from .services import (
    deliver_incident_message,
    build_incident_message_bodies,
    build_recipient_snapshot,
    render_template_preview,
)
from .ms_graph import (
    fetch_directory_lists,
    fetch_directory_list_by_id,
    fetch_directory_list_by_email,
    ActiveDirectoryConfigurationError,
)

logger = logging.getLogger(__name__)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    permission_classes = [permissions.AllowAny]


class RefreshView(TokenRefreshView):
    permission_classes = [permissions.AllowAny]


class SessionLoginView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        refresh = RefreshToken.for_user(request.user)
        teams = Team.objects.filter(memberships__user=request.user).distinct()
        team_data = TeamSerializer(teams, many=True, context={"request": request}).data
        role = get_user_role(request.user)
        data = {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": {
                "username": request.user.username,
                "email": request.user.email,
                "first_name": request.user.first_name,
                "last_name": request.user.last_name,
                "role": role,
                "role_label": UserRole(role).label if role in UserRole.values else role,
            },
            "teams": team_data,
        }
        return Response(data)


class TeamViewSet(viewsets.ModelViewSet):
    serializer_class = TeamSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "public_id"

    def get_queryset(self):
        user = self.request.user
        qs = Team.objects.all().prefetch_related("memberships")
        if user_is_global_team_admin(user):
            return qs
        return qs.filter(Q(memberships__user=user) | Q(created_by=user)).distinct()

    def perform_create(self, serializer):
        user = self.request.user
        team = serializer.save(created_by=user)
        membership, created = TeamMembership.objects.get_or_create(
            team=team,
            user=user,
            defaults={"role": TeamMembership.Role.TEAM_ADMIN},
        )
        if not created and membership.role != TeamMembership.Role.TEAM_ADMIN:
            membership.role = TeamMembership.Role.TEAM_ADMIN
            membership.save(update_fields=["role"])

    def perform_update(self, serializer):
        team = serializer.instance
        self._ensure_team_manager(self.request.user, team)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_team_manager(self.request.user, instance)
        instance.delete()

    def _ensure_team_manager(self, user, team):
        if user_is_system_admin(user):
            return
        if team.created_by_id == user.id:
            return
        if user_can_manage_team(user, team):
            return
        raise PermissionDenied("You do not have permission to modify this team.")


class DirectoryDistributionListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        search = (request.query_params.get("search") or "").strip()
        email = (request.query_params.get("email") or "").strip()
        try:
            if email:
                group = fetch_directory_list_by_email(email)
                groups = [group] if group else []
            else:
                groups = fetch_directory_lists(search=search)
        except ActiveDirectoryConfigurationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except requests.exceptions.HTTPError as exc:  # Graph returned a specific status
            response = getattr(exc, "response", None)
            status_code = response.status_code if response is not None else status.HTTP_502_BAD_GATEWAY
            detail = "Microsoft Graph rejected the request."
            if response is not None:
                try:
                    payload = response.json()
                except ValueError:
                    payload = None
                if isinstance(payload, dict):
                    graph_error = payload.get("error") or {}
                    message = graph_error.get("message") or payload.get("detail")
                    if message:
                        detail = f"Microsoft Graph error: {message}"
            if status_code in (401, 403):
                detail = (
                    "Microsoft Graph returned a permission error. "
                    "Verify that the Azure AD app registration has Group.Read.All and Directory.Read.All "
                    "application permissions with admin consent."
                )
            logger.warning("Microsoft Graph returned %s while searching groups: %s", status_code, exc)
            return Response({"detail": detail}, status=status_code)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Failed to fetch Microsoft 365 groups: %s", exc)
            return Response(
                {"detail": "Unable to load directory distribution lists."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        data = []
        for group in groups:
            email_value = group.get("mail")
            display_name = group.get("displayName") or group.get("mailNickname") or email_value
            data.append(
                {
                    "id": group.get("id"),
                    "graph_id": group.get("id"),
                    "name": display_name,
                    "display_name": display_name,
                    "mail": email_value,
                    "email": email_value,
                    "description": group.get("description") or group.get("mailNickname") or "",
                }
            )
        return Response(data)


class IncidentViewSet(viewsets.ModelViewSet):
    serializer_class = IncidentSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "reference_id"

    def get_queryset(self):
        qs = (
            Incident.objects.select_related(
                "team",
                "created_by",
                "closed_by",
            )
            .prefetch_related("distribution_lists")
            .annotate(message_total=Count("messages"))
        )
        team_id = self.request.query_params.get("team")
        if team_id:
            qs = qs.filter(team__public_id=team_id)
        user = self.request.user
        if user_is_global_team_admin(user):
            return qs
        return qs.filter(team__memberships__user=user).distinct()

    def perform_create(self, serializer):
        team = serializer.validated_data["team"]
        user = self.request.user
        if not user_in_team(user, team):
            raise PermissionDenied("You are not assigned to this team.")
        serializer.save(created_by=user)

    def perform_update(self, serializer):
        team = serializer.instance.team
        user = self.request.user
        if not user_can_manage_team(user, team):
            raise PermissionDenied("Only team admins can update incidents.")
        serializer.save()

    @action(detail=True, methods=["post"], url_path="close")
    def close_incident(self, request, pk=None):
        incident = self.get_object()
        serializer = IncidentCloseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if incident.is_closed:
            return Response({"detail": "Incident already closed."}, status=status.HTTP_200_OK)

        incident.status = Incident.Status.CLOSED
        incident.closed_at = timezone.now()
        incident.closed_by = request.user
        incident.save(update_fields=["status", "closed_at", "closed_by"])

        data = serializer.validated_data
        requested_graph_ids = data.get("distribution_lists") or []
        incident_lists = incident.distribution_lists.all()
        if requested_graph_ids:
            selected_lists = incident_lists.filter(graph_id__in=requested_graph_ids)
            if selected_lists.count() != len(requested_graph_ids):
                return Response(
                    {"detail": "One or more distribution lists are invalid for this incident."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            selected_lists = incident_lists
        if not selected_lists.exists():
            return Response(
                {"detail": "No distribution lists are configured for this incident."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        message = IncidentMessage.objects.create(
            incident=incident,
            author=request.user,
            subject=data["final_subject"],
            body=data["final_body"],
            template_type=data.get("template_type", incident.template_type),
            extra_recipients=data.get("extra_recipients", []),
            point_of_contact=data.get("point_of_contact")
            or request.user.get_full_name()
            or request.user.email,
            point_of_contact_email=data.get("point_of_contact_email")
            or request.user.email
            or "",
            problem_description=data.get("problem_description") or incident.problem_description,
            workaround=data.get("workaround") or incident.workaround,
            next_communication_time=data.get("next_communication_time") or incident.next_communication_time,
        )
        message.distribution_lists.set(selected_lists)
        text_body, html_body, template_version = build_incident_message_bodies(
            message, data.get("final_body", "")
        )
        update_fields = []
        if text_body:
            message.body = text_body
            update_fields.append("body")
        if html_body is not None:
            message.body_html = html_body
            update_fields.append("body_html")
        if template_version:
            message.template_version = template_version
            update_fields.append("template_version")
        snapshot = build_recipient_snapshot(message)
        if snapshot:
            message.recipients_snapshot = snapshot
            update_fields.append("recipients_snapshot")
        if update_fields:
            message.save(update_fields=update_fields)
        deliver_incident_message(message)
        return Response(self.get_serializer(incident).data)


class IncidentMessageViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = IncidentMessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        queryset = IncidentMessage.objects.select_related("incident", "author").prefetch_related(
            "attachments", "distribution_lists"
        )
        incident_reference = self.request.query_params.get("incident")
        if incident_reference:
            queryset = queryset.filter(incident__reference_id=incident_reference)
        user = self.request.user
        if user_is_global_team_admin(user):
            return queryset
        return queryset.filter(incident__team__memberships__user=user).distinct()

    def perform_create(self, serializer):
        incident = serializer.validated_data["incident"]
        user = self.request.user
        if not user_in_team(user, incident.team):
            raise PermissionDenied("You are not assigned to this team.")
        message = serializer.save()
        try:
            deliver_incident_message(message)
        except ValueError as exc:
            message.delete()
            raise ValidationError({"distribution_lists": str(exc)}) from exc


class TemplatesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        templates = EmailTemplate.objects.filter(is_active=True).order_by("name")
        serializer = AnnouncementTemplateSerializer(templates, many=True)
        return Response(serializer.data)


class TemplatePreviewView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, template_key):
        context = request.data.get("context") or {}
        if not isinstance(context, dict):
            return Response({"detail": "context must be an object."}, status=status.HTTP_400_BAD_REQUEST)
        preview = render_template_preview(template_key, context)
        if not preview:
            return Response({"detail": "Template not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(preview)


class DashboardSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        incidents = Incident.objects.all()
        if not user_is_global_team_admin(user):
            incidents = incidents.filter(team__memberships__user=user)

        open_incidents = incidents.filter(status__in=[Incident.Status.OPEN, Incident.Status.MONITORING])
        recent_messages = (
            IncidentMessage.objects.filter(incident__in=incidents)
            .select_related("incident")
            .order_by("-created_at")[:10]
        )

        data = {
            "open_incident_count": open_incidents.count(),
            "recent_messages": [
                {
                    "id": str(message.public_id),
                    "incident_reference": message.incident.reference_id,
                    "incident_inc_number": message.incident.inc_number,
                    "subject": message.subject,
                    "created_at": message.created_at.isoformat(),
                    "status": message.incident.status,
                }
                for message in recent_messages
            ],
        }
        return Response(data)
