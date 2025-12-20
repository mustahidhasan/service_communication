import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.text import slugify

User = get_user_model()


class Team(models.Model):
    name = models.CharField(max_length=150, unique=True)
    slug = models.SlugField(max_length=160, unique=True, blank=True)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="teams_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class TeamMembership(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        TEAM_ADMIN = "team_admin", "Team Admin"

    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="team_memberships")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.USER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("team", "user")

    @property
    def is_team_admin(self):
        return self.role == self.Role.TEAM_ADMIN

    def __str__(self):
        return f"{self.user} -> {self.team} ({self.role})"


class DistributionList(models.Model):
    class Source(models.TextChoices):
        CUSTOM = "custom", "Custom"
        DIRECTORY = "directory", "Active Directory"

    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    source = models.CharField(
        max_length=32, choices=Source.choices, default=Source.DIRECTORY, db_index=True
    )
    external_id = models.CharField(max_length=255, unique=True, blank=True, null=True)
    email = models.EmailField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name="distribution_lists_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)

    @property
    def is_directory_managed(self):
        return self.source == self.Source.DIRECTORY

    def __str__(self):
        suffix = f" ({self.email})" if self.email else ""
        return f"{self.name}{suffix}"


class EmailTemplate(models.Model):
    key = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    subject = models.CharField(max_length=255)
    body_text = models.TextField()
    body_html = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)

    def __str__(self):
        return f"{self.name} (v{self.version})"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        from .template_loader import invalidate_template_cache  # pylint: disable=import-outside-toplevel

        invalidate_template_cache(self.key)

    def delete(self, *args, **kwargs):
        key = self.key
        super().delete(*args, **kwargs)
        from .template_loader import invalidate_template_cache  # pylint: disable=import-outside-toplevel

        invalidate_template_cache(key)


class Incident(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        MONITORING = "monitoring", "Monitoring"
        CLOSED = "closed", "Closed"

    class IncidentType(models.TextChoices):
        MAJOR = "major", "Major"
        CRITICAL = "critical", "Critical"
        INFORMATIONAL = "informational", "Informational"

    class TemplateType(models.TextChoices):
        MAJOR = "major", "Major Incident"
        INCIDENT = "incident", "Incident"
        SERVICE = "service", "Service Announcement"

    reference_id = models.CharField(max_length=32, unique=True, editable=False, default="")
    inc_number = models.CharField(max_length=64, blank=True)
    incident_type = models.CharField(
        max_length=32, choices=IncidentType.choices, default=IncidentType.MAJOR
    )
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="incidents")
    title = models.CharField(max_length=200)
    summary = models.TextField()
    problem_description = models.TextField(blank=True)
    workaround = models.TextField(blank=True)
    affected_regions = models.JSONField(default=list, blank=True)
    next_communication_time = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    severity = models.CharField(max_length=30, default="P3")
    template_type = models.CharField(
        max_length=20, choices=TemplateType.choices, default=TemplateType.INCIDENT
    )
    impact = models.TextField(blank=True)
    primary_distribution_list = models.ForeignKey(
        DistributionList,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="primary_incidents",
    )
    distribution_lists = models.ManyToManyField(
        DistributionList,
        related_name="incidents",
        blank=True,
    )
    default_extra_recipients = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="incidents_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="incidents_closed"
    )

    def save(self, *args, **kwargs):
        if not self.reference_id:
            self.reference_id = uuid.uuid4().hex[:12].upper()
        super().save(*args, **kwargs)

    @property
    def is_closed(self):
        return self.status == self.Status.CLOSED

    def __str__(self):
        return f"{self.reference_id} - {self.title}"


def attachment_upload_path(instance, filename):
    incident_id = instance.message.incident_id
    unique_name = uuid.uuid4().hex
    return f"incident_attachments/{incident_id}/{unique_name}-{filename}"


class IncidentMessage(models.Model):
    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="incident_messages"
    )
    distribution_list = models.ForeignKey(
        DistributionList,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incident_messages",
    )
    distribution_lists = models.ManyToManyField(
        DistributionList,
        blank=True,
        related_name="incident_messages_multi",
    )
    point_of_contact = models.CharField(max_length=200, blank=True)
    problem_description = models.TextField(blank=True)
    workaround = models.TextField(blank=True)
    next_communication_time = models.DateTimeField(null=True, blank=True)
    subject = models.CharField(max_length=200)
    body = models.TextField()
    body_html = models.TextField(blank=True)
    template_type = models.CharField(
        max_length=20, choices=Incident.TemplateType.choices, default=Incident.TemplateType.INCIDENT
    )
    extra_recipients = models.JSONField(default=list, blank=True)
    sent_to = models.JSONField(default=list, blank=True)
    delivery_status = models.CharField(max_length=50, default="pending")
    point_of_contact_email = models.EmailField(blank=True)
    template_version = models.PositiveIntegerField(null=True, blank=True)
    recipients_snapshot = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.incident.reference_id} | {self.subject}"


class MessageAttachment(models.Model):
    message = models.ForeignKey(
        IncidentMessage, on_delete=models.CASCADE, related_name="attachments"
    )
    file = models.FileField(upload_to=attachment_upload_path)
    original_name = models.CharField(max_length=255, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.original_name and self.file:
            self.original_name = self.file.name
        super().save(*args, **kwargs)

    def __str__(self):
        return self.original_name or self.file.name
