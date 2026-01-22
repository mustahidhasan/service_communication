from django.contrib import admin

from .models import UserActivity, UserProfile


@admin.register(UserActivity)
class UserActivityAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "activity_type", "timestamp"]
    search_fields = ["user__username", "user__email", "activity_type"]
    list_filter = ["activity_type", "timestamp"]


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "role", "assigned_manually", "updated_at"]
    list_filter = ["role", "assigned_manually"]
    search_fields = ["user__username", "user__email"]
