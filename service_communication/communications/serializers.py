import re

from django.contrib.auth import get_user_model

from USER.models import (
    UserRole,
    get_user_role,
    user_is_global_team_admin,
    user_is_system_admin,
)
from rest_framework import serializers
from rest_framework.fields import empty
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import (
    Team,
    TeamMembership,
    Incident,
    IncidentDistributionList,
    IncidentMessage,
    MessageAttachment,
    EmailTemplate,
)
from .permissions import user_can_manage_team
from .services import build_incident_message_bodies, build_recipient_snapshot

User = get_user_model()

EMAIL_SPLIT_PATTERN = re.compile(r"[,\s;]+")


def _flatten_email_values(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in EMAIL_SPLIT_PATTERN.split(value) if part.strip()]
    if isinstance(value, (list, tuple, set)):
        flattened = []
        for item in value:
            flattened.extend(_flatten_email_values(item))
        return flattened
    return [str(value).strip()] if str(value).strip() else []


def _dedupe_preserve_order(values):
    seen = set()
    ordered = []
    for item in values:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    return ordered


class EmailListField(serializers.ListField):
    def __init__(self, **kwargs):
        kwargs.setdefault("child", serializers.EmailField())
        kwargs.setdefault("allow_empty", True)
        kwargs.setdefault("required", False)
        super().__init__(**kwargs)

    def get_value(self, dictionary):
        if hasattr(dictionary, "getlist"):
            if self.field_name in dictionary:
                return dictionary.getlist(self.field_name)
            return empty
        return super().get_value(dictionary)

    def to_internal_value(self, data):
        if data is empty:
            data = []
        normalized = _flatten_email_values(data)
        validated = super().to_internal_value(normalized)
        return _dedupe_preserve_order(validated)


class IncidentDistributionListField(serializers.Field):
    default_error_messages = {
        "invalid_type": "Distribution lists must be a list of objects.",
        "missing_graph_id": "Each distribution list must include a graph_id.",
        "missing_email": "Each distribution list must include an email address.",
    }

    def to_representation(self, value):
        if hasattr(value, "all"):
            entries = value.all()
        else:
            entries = value or []
        return [
            {
                "graph_id": entry.graph_id,
                "display_name": entry.display_name,
                "email": entry.email,
            }
            for entry in entries
        ]

    def to_internal_value(self, data):
        if data is empty:
            return []
        if not isinstance(data, list):
            self.fail("invalid_type")
        normalized = []
        for item in data:
            if not isinstance(item, dict):
                self.fail("invalid_type")
            graph_id = (item.get("graph_id") or item.get("id") or "").strip()
            display_name = (item.get("display_name") or item.get("name") or "").strip()
            email = (item.get("email") or item.get("mail") or "").strip()
            if not graph_id:
                self.fail("missing_graph_id")
            if not email:
                self.fail("missing_email")
            normalized.append(
                {
                    "graph_id": graph_id,
                    "display_name": display_name or email,
                    "email": email,
                }
            )
        return normalized


class DistributionGraphIdListField(serializers.ListField):
    def __init__(self, **kwargs):
        kwargs.setdefault("child", serializers.CharField())
        kwargs.setdefault("allow_empty", True)
        kwargs.setdefault("required", False)
        super().__init__(**kwargs)

    def to_representation(self, value):
        if hasattr(value, "all"):
            items = value.all()
        else:
            items = value or []
        return [getattr(item, "graph_id", item) for item in items]

    def to_internal_value(self, data):
        values = super().to_internal_value(data)
        deduped = []
        seen = set()
        for value in values:
            normalized = value.strip()
            if not normalized:
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped


class TeamMembershipSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True)

    class Meta:
        model = TeamMembership
        fields = ["id", "team", "user", "user_email", "user_name", "role", "created_at"]
        read_only_fields = ["id", "created_at"]


class TeamSerializer(serializers.ModelSerializer):
    membership_role = serializers.SerializerMethodField()
    created_by = serializers.IntegerField(source="created_by_id", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "created_at",
            "updated_at",
            "membership_role",
            "created_by",
            "created_by_name",
            "can_manage",
        ]
        read_only_fields = [
            "slug",
            "created_at",
            "updated_at",
            "membership_role",
            "created_by",
            "created_by_name",
            "can_manage",
        ]

    def get_membership_role(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if user_is_global_team_admin(user):
            return TeamMembership.Role.TEAM_ADMIN
        membership = obj.memberships.filter(user=user).first()
        return membership.role if membership else None

    def get_can_manage(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if user_is_system_admin(user):
            return True
        if obj.created_by_id and obj.created_by_id == user.id:
            return True
        return user_can_manage_team(user, obj)

    def get_created_by_name(self, obj):
        creator = getattr(obj, "created_by", None)
        if not creator:
            return None
        full_name = creator.get_full_name()
        if full_name:
            return full_name
        return creator.email or getattr(creator, "username", None)


class MessageAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageAttachment
        fields = ["id", "original_name", "file", "uploaded_at"]
        read_only_fields = ["id", "original_name", "uploaded_at"]


class IncidentSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True)
    created_by_email = serializers.CharField(source="created_by.email", read_only=True)
    is_closed = serializers.BooleanField(read_only=True)
    distribution_lists = IncidentDistributionListField(required=False)
    default_extra_recipients = EmailListField()
    messages_count = serializers.SerializerMethodField()

    def get_messages_count(self, obj):
        annotated = getattr(obj, "message_total", None)
        if annotated is not None:
            return annotated
        return obj.messages.count()

    def create(self, validated_data):
        request = self.context.get("request")
        distribution_entries = validated_data.pop("distribution_lists", [])
        if request:
            validated_data["created_by"] = request.user
        incident = Incident.objects.create(**validated_data)
        self._sync_distribution_lists(incident, distribution_entries)
        return incident

    def update(self, instance, validated_data):
        distribution_entries = validated_data.pop("distribution_lists", None)
        incident = super().update(instance, validated_data)
        if distribution_entries is not None:
            self._sync_distribution_lists(incident, distribution_entries)
        return incident

    def _sync_distribution_lists(self, incident, entries):
        existing = {item.graph_id: item for item in incident.distribution_lists.all()}
        seen = set()
        for payload in entries:
            graph_id = payload["graph_id"]
            seen.add(graph_id)
            current = existing.get(graph_id)
            if current:
                updates = []
                if current.display_name != payload["display_name"]:
                    current.display_name = payload["display_name"]
                    updates.append("display_name")
                if current.email != payload["email"]:
                    current.email = payload["email"]
                    updates.append("email")
                if updates:
                    current.save(update_fields=updates)
            else:
                IncidentDistributionList.objects.create(
                    incident=incident,
                    graph_id=graph_id,
                    display_name=payload["display_name"],
                    email=payload["email"],
                )
        incident.distribution_lists.exclude(graph_id__in=seen).delete()

    def validate_affected_regions(self, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        if isinstance(value, list):
            return value
        return []

    class Meta:
        model = Incident
        fields = [
            "id",
            "reference_id",
            "team",
            "team_name",
            "inc_number",
            "incident_type",
            "title",
            "summary",
            "problem_description",
            "workaround",
            "affected_regions",
            "next_communication_time",
            "impact",
            "severity",
            "status",
            "template_type",
            "distribution_lists",
            "default_extra_recipients",
            "created_by",
            "created_by_name",
            "created_by_email",
            "created_at",
            "updated_at",
            "closed_at",
            "closed_by",
            "is_closed",
            "messages_count",
        ]
        read_only_fields = [
            "id",
            "reference_id",
            "team_name",
            "created_by",
            "created_by_name",
            "created_by_email",
            "created_at",
            "updated_at",
            "closed_at",
            "closed_by",
            "is_closed",
            "messages_count",
        ]
        extra_kwargs = {
            "inc_number": {"allow_blank": False, "required": True},
            "problem_description": {"allow_blank": False, "required": True},
            "workaround": {"allow_blank": False, "required": True},
            "next_communication_time": {"allow_null": False, "required": True},
            "default_extra_recipients": {"required": False},
        }

    def validate_distribution_lists(self, value):
        if not value:
            raise serializers.ValidationError("Select at least one distribution list.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is None:
            errors = {}
            if not attrs.get("inc_number"):
                errors["inc_number"] = "INC number is required."
            if not attrs.get("title"):
                errors["title"] = "Subject is required."
            if not attrs.get("incident_type"):
                errors["incident_type"] = "Type is required."
            if not attrs.get("problem_description"):
                errors["problem_description"] = "Problem description is required."
            if not attrs.get("workaround"):
                errors["workaround"] = "Workaround is required."
            affected = attrs.get("affected_regions") or []
            if not affected:
                errors["affected_regions"] = "Select at least one affected region."
            if attrs.get("next_communication_time") is None:
                errors["next_communication_time"] = "Next communication time is required."
            if errors:
                raise serializers.ValidationError(errors)
        return attrs


class IncidentMessageSerializer(serializers.ModelSerializer):
    incident_reference = serializers.CharField(source="incident.reference_id", read_only=True)
    attachments = MessageAttachmentSerializer(many=True, read_only=True)
    author_name = serializers.CharField(source="author.get_full_name", read_only=True)
    extra_recipients = EmailListField()
    distribution_lists = DistributionGraphIdListField()

    class Meta:
        model = IncidentMessage
        fields = [
            "id",
            "incident",
            "incident_reference",
            "author",
            "author_name",
            "distribution_lists",
            "subject",
            "body",
            "body_html",
            "template_type",
            "extra_recipients",
            "sent_to",
            "recipients_snapshot",
            "template_version",
            "point_of_contact",
            "point_of_contact_email",
            "problem_description",
            "workaround",
            "next_communication_time",
            "delivery_status",
            "created_at",
            "attachments",
        ]
        read_only_fields = [
            "id",
            "incident_reference",
            "author",
            "author_name",
            "body_html",
            "sent_to",
            "recipients_snapshot",
            "template_version",
            "delivery_status",
            "created_at",
            "attachments",
        ]
        extra_kwargs = {
            "body": {"allow_blank": True, "required": False},
            "point_of_contact": {"allow_blank": True, "required": False},
            "point_of_contact_email": {"allow_blank": False, "required": True},
        }

    def create(self, validated_data):
        request = self.context.get("request")
        files = request.FILES.getlist("attachments") if request else []
        distribution_lists = validated_data.pop("distribution_lists", [])
        validated_data["author"] = request.user if request else None
        incident = validated_data["incident"]
        user = request.user if request else None
        point_of_contact_name = (
            validated_data.get("point_of_contact")
            or (user.get_full_name() if user and user.get_full_name() else None)
            or (user.email if user else "")
        )
        validated_data["point_of_contact"] = point_of_contact_name
        validated_data["point_of_contact_email"] = (
            validated_data.get("point_of_contact_email") or (user.email if user else "")
        )
        validated_data["problem_description"] = (
            validated_data.get("problem_description")
            or incident.problem_description
            or incident.summary
        )
        validated_data["workaround"] = validated_data.get("workaround") or incident.workaround
        validated_data["next_communication_time"] = (
            validated_data.get("next_communication_time") or incident.next_communication_time
        )
        raw_body = validated_data.get("body", "")
        message = IncidentMessage.objects.create(**validated_data)
        for file in files:
            MessageAttachment.objects.create(
                message=message,
                file=file,
                original_name=getattr(file, "name", ""),
            )
        selected_lists = incident.distribution_lists.filter(graph_id__in=distribution_lists)
        if distribution_lists and selected_lists.count() != len(distribution_lists):
            raise serializers.ValidationError(
                {"distribution_lists": "Invalid distribution list selection for this incident."}
            )
        if selected_lists.exists():
            message.distribution_lists.set(selected_lists)
        else:
            message.distribution_lists.set(incident.distribution_lists.all())
        text_body, html_body, template_version = build_incident_message_bodies(message, raw_body)
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
        return message

class IncidentCloseSerializer(serializers.Serializer):
    final_subject = serializers.CharField()
    final_body = serializers.CharField()
    distribution_lists = DistributionGraphIdListField()
    template_type = serializers.ChoiceField(
        choices=Incident.TemplateType.choices, default=Incident.TemplateType.INCIDENT
    )
    extra_recipients = EmailListField()
    point_of_contact = serializers.CharField(required=False, allow_blank=True)
    point_of_contact_email = serializers.EmailField(required=False, allow_blank=True)
    problem_description = serializers.CharField(required=False, allow_blank=True)
    workaround = serializers.CharField(required=False, allow_blank=True)
    next_communication_time = serializers.DateTimeField(required=False, allow_null=True)


class AnnouncementTemplateSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="key")
    label = serializers.CharField(source="name")
    body = serializers.CharField(source="body_text")
    html_body = serializers.CharField(source="body_html", allow_blank=True, required=False)

    class Meta:
        model = EmailTemplate
        fields = ["id", "label", "description", "subject", "body", "html_body", "version", "updated_at"]


class LoginSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        role = get_user_role(user)
        data["user"] = {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": role,
            "role_label": UserRole(role).label if role in UserRole.values else role,
        }
        request = self.context.get("request")
        teams = Team.objects.filter(memberships__user=user).distinct()
        data["teams"] = TeamSerializer(teams, many=True, context={"request": request}).data
        return data
