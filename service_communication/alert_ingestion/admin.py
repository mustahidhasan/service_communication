from django.contrib import admin

from .models import Mailbox, ParsingRule, MappingRule, AlertEvent, AlertEmail, DeliveryAttempt


@admin.register(Mailbox)
class MailboxAdmin(admin.ModelAdmin):
    list_display = ("name", "address", "ingestion_mode", "is_active", "last_sync_at")
    search_fields = ("name", "address")
    list_filter = ("ingestion_mode", "is_active")


@admin.register(ParsingRule)
class ParsingRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "priority", "is_active")
    search_fields = ("name",)
    list_filter = ("is_active",)


@admin.register(MappingRule)
class MappingRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "priority", "is_active", "resource_identifier")
    search_fields = ("name", "resource_identifier")
    list_filter = ("is_active",)


@admin.register(AlertEvent)
class AlertEventAdmin(admin.ModelAdmin):
    list_display = ("correlation_key", "status", "severity", "last_seen_at")
    search_fields = ("correlation_key", "alert_name", "resource_identifier")
    list_filter = ("status",)


@admin.register(AlertEmail)
class AlertEmailAdmin(admin.ModelAdmin):
    list_display = ("subject", "sender", "received_at", "event")
    search_fields = ("subject", "sender", "message_id")


@admin.register(DeliveryAttempt)
class DeliveryAttemptAdmin(admin.ModelAdmin):
    list_display = ("event", "action", "status", "http_status", "created_at")
    search_fields = ("event__correlation_key",)
    list_filter = ("status", "action")
