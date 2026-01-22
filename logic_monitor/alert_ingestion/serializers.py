from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from USER.models import UserRole, get_user_role

from .models import (
    Mailbox,
    ParsingRule,
    MappingRule,
    AlertEvent,
    AlertEmail,
    DeliveryAttempt,
)


class MailboxSerializer(serializers.ModelSerializer):
    class Meta:
        model = Mailbox
        fields = "__all__"


class ParsingRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParsingRule
        fields = "__all__"


class MappingRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = MappingRule
        fields = "__all__"


class AlertEmailSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertEmail
        fields = "__all__"


class DeliveryAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryAttempt
        fields = "__all__"


class AlertEventSerializer(serializers.ModelSerializer):
    emails_count = serializers.IntegerField(read_only=True)
    deliveries_count = serializers.IntegerField(read_only=True)
    last_email_subject = serializers.CharField(source="last_email.subject", read_only=True)

    class Meta:
        model = AlertEvent
        fields = [
            "id",
            "mailbox",
            "correlation_key",
            "status",
            "alert_name",
            "resource_identifier",
            "alert_category",
            "source_system",
            "severity",
            "state",
            "first_seen_at",
            "last_seen_at",
            "occurrence_count",
            "matched_parser_rule",
            "matched_mapping_rule",
            "last_delivery_status",
            "last_email",
            "created_at",
            "updated_at",
            "emails_count",
            "deliveries_count",
            "last_email_subject",
        ]


class AlertEventDetailSerializer(AlertEventSerializer):
    emails = AlertEmailSerializer(many=True, read_only=True)
    deliveries = DeliveryAttemptSerializer(many=True, read_only=True)

    class Meta(AlertEventSerializer.Meta):
        fields = AlertEventSerializer.Meta.fields + ["emails", "deliveries"]


class AlertLoginSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        user = self.user
        role = get_user_role(user)
        data["user"] = {
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": role,
            "role_label": UserRole(role).label if role in UserRole.values else role,
        }
        return data
