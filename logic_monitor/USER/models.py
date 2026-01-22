# models.py
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

User = get_user_model()


class UserRole(models.TextChoices):
    USER = "user", "User"
    TEAM_ADMIN = "team_admin", "Team Admin"
    SYSTEM_ADMIN = "system_admin", "System Admin"


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=20, choices=UserRole.choices, default=UserRole.USER)
    assigned_manually = models.BooleanField(
        default=False,
        help_text="Indicates if the current role was explicitly assigned by an admin.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "User Role"
        verbose_name_plural = "User Roles"

    def __str__(self):
        return f"{self.user.email or self.user.username} -> {self.get_role_display()}"

    @property
    def is_system_admin(self):
        return self.role == UserRole.SYSTEM_ADMIN

    @property
    def is_team_admin(self):
        return self.role in (UserRole.TEAM_ADMIN, UserRole.SYSTEM_ADMIN)

    def set_role(self, next_role, manual=False):
        """Centralize validation when mutating the role."""
        if next_role not in UserRole.values:
            raise ValueError(f"Invalid role '{next_role}'")
        self.role = next_role
        self.assigned_manually = manual
        self.save(update_fields=["role", "assigned_manually", "updated_at"])


@receiver(post_save, sender=User)
def ensure_user_profile(sender, instance, created, **kwargs):
    """
    Guarantee that every user has a corresponding UserProfile.
    Existing users that somehow missed the relation will be backfilled.
    """
    if created:
        UserProfile.objects.create(user=instance)
    else:
        UserProfile.objects.get_or_create(user=instance)


class UserActivity(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    activity_type = models.CharField(max_length=100)
    timestamp = models.DateTimeField(auto_now_add=True)
    session_status = models.BooleanField(default=True)
    duration = models.FloatField(null=True, blank=True)

    @property
    def formatted_duration(self):
        if self.duration:
            td = timedelta(seconds=self.duration)
            return str(td)
        return "N/A"

    def __str__(self):
        return f"{self.user.email} - {self.activity_type}"


def get_user_profile(user):
    if not user or not getattr(user, "is_authenticated", False):
        return None
    try:
        return user.profile
    except UserProfile.DoesNotExist:
        return None


def get_user_role(user):
    profile = get_user_profile(user)
    if profile:
        return profile.role
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return UserRole.SYSTEM_ADMIN
    return UserRole.USER


def user_is_system_admin(user):
    return get_user_role(user) == UserRole.SYSTEM_ADMIN


def user_is_global_team_admin(user):
    return get_user_role(user) in (UserRole.TEAM_ADMIN, UserRole.SYSTEM_ADMIN)
