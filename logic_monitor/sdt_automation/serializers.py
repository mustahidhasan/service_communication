from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from USER.models import UserRole, get_user_role

from .models import (
    MailboxConfig,
    EmailIngested,
    ParseResult,
    MappingRule,
    MappingResult,
    SDTRequest,
)


class MailboxConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MailboxConfig
        fields = "__all__"


class MappingRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = MappingRule
        fields = "__all__"


class ParseResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParseResult
        fields = "__all__"


class MappingResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = MappingResult
        fields = "__all__"


class SDTRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = SDTRequest
        fields = "__all__"


class EmailIngestedSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmailIngested
        fields = "__all__"


class EmailIngestedDetailSerializer(EmailIngestedSerializer):
    parse_result = ParseResultSerializer(read_only=True)
    mapping_result = MappingResultSerializer(read_only=True)
    sdt_requests = SDTRequestSerializer(many=True, read_only=True)

    class Meta(EmailIngestedSerializer.Meta):
        fields = "__all__"


class SdtLoginSerializer(TokenObtainPairSerializer):
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


class LogicMonitorSdtCreateSerializer(serializers.Serializer):
    target_type = serializers.ChoiceField(choices=["device", "device_group", "service"])
    target_id = serializers.CharField()
    start_time = serializers.CharField()
    end_time = serializers.CharField()
    comment = serializers.CharField()
    email_message_id = serializers.CharField(required=False, allow_blank=True)
    external_ref = serializers.CharField(required=False, allow_blank=True)
