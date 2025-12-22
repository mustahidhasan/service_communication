from django.contrib import admin
from .models import (
    Team,
    TeamMembership,
    Incident,
    IncidentDistributionList,
    IncidentMessage,
    MessageAttachment,
    EmailTemplate,
)


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_by", "created_at")
    search_fields = ("name", "slug")


@admin.register(TeamMembership)
class TeamMembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "team", "role", "created_at")
    list_filter = ("role", "team")
    search_fields = ("user__username", "user__email", "team__name")


@admin.register(EmailTemplate)
class EmailTemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "key", "version", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "key")


class MessageAttachmentInline(admin.TabularInline):
    model = MessageAttachment
    extra = 0


class IncidentMessageInline(admin.TabularInline):
    model = IncidentMessage
    extra = 0


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = (
        "reference_id",
        "inc_number",
        "title",
        "incident_type",
        "team",
        "status",
        "severity",
        "next_communication_time",
        "created_at",
    )
    list_filter = ("team", "status", "severity", "template_type", "incident_type")
    search_fields = ("reference_id", "title", "inc_number")
    inlines = [IncidentMessageInline]


@admin.register(IncidentDistributionList)
class IncidentDistributionListAdmin(admin.ModelAdmin):
    list_display = ("incident", "display_name", "email", "graph_id", "created_at")
    search_fields = ("display_name", "email", "graph_id", "incident__inc_number")


@admin.register(IncidentMessage)
class IncidentMessageAdmin(admin.ModelAdmin):
    list_display = ("incident", "subject", "template_type", "point_of_contact", "created_at")
    list_filter = ("template_type",)
    search_fields = ("subject", "incident__reference_id")
    inlines = [MessageAttachmentInline]
