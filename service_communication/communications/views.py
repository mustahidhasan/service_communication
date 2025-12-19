import logging

from django.db.models import Q, Count
from django.utils import timezone
from rest_framework import viewsets, permissions, status, mixins
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    Team,
    TeamMembership,
    DistributionList,
    Incident,
    IncidentMessage,
)
from .serializers import (
    TeamSerializer,
    DistributionListSerializer,
    IncidentSerializer,
    IncidentMessageSerializer,
    AnnouncementTemplateSerializer,
    IncidentCloseSerializer,
    LoginSerializer,
)
from .constants import ANNOUNCEMENT_TEMPLATES
from USER.models import UserRole, get_user_role, user_is_global_team_admin, user_is_system_admin

from .permissions import user_can_manage_team, user_in_team
from .services import deliver_incident_message, build_incident_message_bodies
from .ms_graph import (
    fetch_directory_lists,
    fetch_directory_list_by_id,
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
                "id": request.user.id,
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


class DistributionListViewSet(viewsets.ModelViewSet):
    serializer_class = DistributionListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = DistributionList.objects.prefetch_related("entries")
        team_id = self.request.query_params.get("team")
        if user_is_global_team_admin(user):
            if team_id:
                if team_id == "global":
                    return qs.filter(team__isnull=True)
                return qs.filter(team_id=team_id)
            return qs

        qs = qs.filter(
            Q(team__memberships__user=user) | Q(team__isnull=True) | Q(created_by=user)
        ).distinct()
        if team_id:
            if team_id == "global":
                return qs.filter(team__isnull=True)
            return qs.filter(team_id=team_id)
        return qs

    def perform_create(self, serializer):
        team = serializer.validated_data.get("team")
        user = self.request.user
        if team is None and not user_is_system_admin(user):
            raise PermissionDenied("Only system administrators can create global lists.")
        if team and not user_can_manage_team(user, team):
            raise PermissionDenied("Only team admins can create a team list.")
        serializer.save()

    def perform_update(self, serializer):
        distribution_list = serializer.instance
        user = self.request.user
        if not self._user_can_manage_list(user, distribution_list):
            raise PermissionDenied("You do not have permission to modify this list.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.is_directory_managed:
            raise PermissionDenied("Directory-managed lists are synced from Active Directory.")
        if not self._user_can_manage_list(self.request.user, instance):
            raise PermissionDenied("You do not have permission to delete this list.")
        instance.delete()

    def _user_can_manage_list(self, user, distribution_list):
        if user_is_system_admin(user):
            return True
        if distribution_list.created_by_id == user.id:
            return True
        team = distribution_list.team
        if team and user_can_manage_team(user, team):
            return True
        return False


class DirectoryDistributionListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        search = request.query_params.get("search") or ""
        try:
            groups = fetch_directory_lists(search=search)
        except ActiveDirectoryConfigurationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Failed to fetch Microsoft 365 groups: %s", exc)
            return Response(
                {"detail": "Unable to load directory distribution lists."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        data = []
        for group in groups:
            email = group.get("mail")
            if not email:
                continue
            data.append(
                {
                    "id": group.get("id"),
                    "name": group.get("displayName") or group.get("mailNickname") or email,
                    "mail": email,
                    "description": group.get("description") or group.get("mailNickname") or "",
                }
            )
        return Response(data)

    def post(self, request):
        object_id = request.data.get("id") or request.data.get("object_id")
        if not object_id:
            return Response({"detail": "Directory group id is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            group = fetch_directory_list_by_id(object_id)
        except ActiveDirectoryConfigurationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Failed to import directory list: %s", exc)
            return Response(
                {"detail": "Unable to import the requested distribution list."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        if not group or not group.get("mail"):
            return Response(
                {"detail": "Distribution list email address was not found."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        defaults = {
            "name": group.get("displayName") or group.get("mailNickname") or group.get("mail"),
            "description": group.get("description") or "",
            "email": group.get("mail"),
            "team": None,
            "source": DistributionList.Source.DIRECTORY,
        }
        distribution_list, created = DistributionList.objects.update_or_create(
            external_id=group.get("id"),
            defaults=defaults,
        )
        if created and not distribution_list.created_by:
            distribution_list.created_by = request.user
            distribution_list.save(update_fields=["created_by"])
        distribution_list.entries.all().delete()
        serializer = DistributionListSerializer(distribution_list, context={"request": request})
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class IncidentViewSet(viewsets.ModelViewSet):
    serializer_class = IncidentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Incident.objects.select_related(
            "team",
            "primary_distribution_list",
            "created_by",
            "closed_by",
        ).annotate(message_total=Count("messages"))
        team_id = self.request.query_params.get("team")
        if team_id:
            try:
                qs = qs.filter(team_id=int(team_id))
            except ValueError:
                pass
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
        distribution_list = data.get("distribution_list") or incident.primary_distribution_list
        message = IncidentMessage.objects.create(
            incident=incident,
            author=request.user,
            distribution_list=distribution_list,
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
        if data.get("distribution_lists"):
            message.distribution_lists.set(data["distribution_lists"])
        elif incident.distribution_lists.exists():
            message.distribution_lists.set(incident.distribution_lists.all())
        elif distribution_list:
            message.distribution_lists.add(distribution_list)
        text_body, html_body = build_incident_message_bodies(message, data.get("final_body", ""))
        update_fields = []
        if text_body:
            message.body = text_body
            update_fields.append("body")
        if html_body is not None:
            message.body_html = html_body
            update_fields.append("body_html")
        if update_fields:
            message.save(update_fields=update_fields)
        deliver_incident_message(message)
        return Response(self.get_serializer(incident).data)


class IncidentMessageViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = IncidentMessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        queryset = IncidentMessage.objects.select_related(
            "incident", "author", "distribution_list"
        ).prefetch_related("attachments", "distribution_lists")
        incident_id = self.request.query_params.get("incident")
        if incident_id:
            queryset = queryset.filter(incident_id=incident_id)
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
        deliver_incident_message(message)


class TemplatesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        serializer = AnnouncementTemplateSerializer(ANNOUNCEMENT_TEMPLATES, many=True)
        return Response(serializer.data)


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
                    "id": message.id,
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
