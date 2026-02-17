from django.db import models


class MailboxConfig(models.Model):
    class IngestionMode(models.TextChoices):
        POLL = "poll", "Poll"
        WEBHOOK = "webhook", "Webhook"

    name = models.CharField(max_length=120)
    address = models.EmailField(unique=True)
    ingestion_mode = models.CharField(
        max_length=20, choices=IngestionMode.choices, default=IngestionMode.POLL
    )
    polling_interval_seconds = models.PositiveIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    allowlist_domains = models.JSONField(default=list, blank=True)
    graph_subscription_id = models.CharField(max_length=255, blank=True)
    graph_subscription_secret = models.CharField(max_length=255, blank=True)
    graph_subscription_expires_at = models.DateTimeField(null=True, blank=True)
    last_polled_at = models.DateTimeField(null=True, blank=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} <{self.address}>"


class EmailIngested(models.Model):
    class Status(models.TextChoices):
        INGESTED = "ingested", "Ingested"
        PARSED = "parsed", "Parsed"
        NEEDS_MAPPING = "needs_mapping", "Needs mapping"
        MAPPED = "mapped", "Mapped"
        SDT_CREATED = "sdt_created", "SDT created"
        FAILED = "failed", "Failed"
        IGNORED = "ignored", "Ignored"

    mailbox = models.ForeignKey(MailboxConfig, on_delete=models.SET_NULL, null=True, blank=True)
    provider_message_id = models.CharField(max_length=255, unique=True)
    internet_message_id = models.CharField(max_length=255, blank=True)
    subject = models.TextField(blank=True)
    sender = models.EmailField(blank=True)
    sender_domain = models.CharField(max_length=120, blank=True)
    recipients = models.JSONField(default=list, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    headers = models.JSONField(default=dict, blank=True)
    body_text = models.TextField(blank=True)
    body_html = models.TextField(blank=True)
    attachments_metadata = models.JSONField(default=list, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.INGESTED)
    status_detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.subject or self.provider_message_id}".strip()


class ParseResult(models.Model):
    class Status(models.TextChoices):
        PARSED = "parsed", "Parsed"
        FAILED = "failed", "Failed"

    email = models.OneToOneField(EmailIngested, on_delete=models.CASCADE, related_name="parse_result")
    title = models.CharField(max_length=255, blank=True)
    summary = models.TextField(blank=True)
    start_at = models.DateTimeField(null=True, blank=True)
    end_at = models.DateTimeField(null=True, blank=True)
    timezone = models.CharField(max_length=64, blank=True)
    notes = models.TextField(blank=True)
    backup_start_at = models.DateTimeField(null=True, blank=True)
    backup_end_at = models.DateTimeField(null=True, blank=True)
    backup_timezone = models.CharField(max_length=64, blank=True)
    parse_status = models.CharField(max_length=20, choices=Status.choices, default=Status.PARSED)
    parse_error = models.TextField(blank=True)
    extracted_fields = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.email_id} {self.parse_status}"


class MappingRule(models.Model):
    name = models.CharField(max_length=140)
    is_active = models.BooleanField(default=True)
    priority = models.PositiveIntegerField(default=100)
    sender_contains = models.CharField(max_length=200, blank=True)
    subject_contains = models.CharField(max_length=200, blank=True)
    body_regex = models.TextField(blank=True)
    keyword_list = models.JSONField(default=list, blank=True)
    target_type = models.CharField(max_length=40, default="device")
    target_identifiers = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["priority", "name"]

    def __str__(self):
        return self.name


class MappingResult(models.Model):
    class Status(models.TextChoices):
        MAPPED = "mapped", "Mapped"
        NEEDS_MAPPING = "needs_mapping", "Needs mapping"
        FAILED = "failed", "Failed"

    email = models.OneToOneField(EmailIngested, on_delete=models.CASCADE, related_name="mapping_result")
    targets = models.JSONField(default=list, blank=True)
    matched_rules = models.JSONField(default=list, blank=True)
    mapping_status = models.CharField(max_length=30, choices=Status.choices, default=Status.NEEDS_MAPPING)
    mapping_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.email_id} {self.mapping_status}"


class SDTRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    email = models.ForeignKey(
        EmailIngested,
        on_delete=models.CASCADE,
        related_name="sdt_requests",
        null=True,
        blank=True,
    )
    correlation_key = models.CharField(max_length=255, unique=True)
    payload = models.JSONField(default=dict, blank=True)
    lm_status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    lm_sdt_id = models.CharField(max_length=120, blank=True)
    lm_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.email_id} {self.lm_status}"


class SiteCodeMapping(models.Model):
    vendor_site_code = models.CharField(max_length=120, unique=True, db_index=True)
    lm_site_code = models.CharField(max_length=120, db_index=True)
    notes = models.TextField(blank=True)
    source = models.CharField(max_length=120, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["vendor_site_code"]

    def __str__(self):
        return f"{self.vendor_site_code} -> {self.lm_site_code}"


class SDTQueueItem(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    class CircuitType(models.TextChoices):
        UNKNOWN = "unknown", "Unknown"
        SINGLE = "single", "Single"
        DUAL = "dual", "Dual"

    class TargetType(models.TextChoices):
        SITE = "site", "Site"
        DEVICE = "device", "Device"

    maintenance_id = models.CharField(max_length=255, unique=True)
    vendor_site_code = models.CharField(max_length=120, db_index=True)
    lm_site_code = models.CharField(max_length=120, blank=True, null=True, db_index=True)
    start_time_utc = models.DateTimeField(db_index=True)
    end_time_utc = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    circuit_type = models.CharField(max_length=20, choices=CircuitType.choices, default=CircuitType.UNKNOWN)
    target_type = models.CharField(max_length=20, choices=TargetType.choices, default=TargetType.SITE)
    target_ids = models.JSONField(default=list, blank=True)
    lm_sdt_ids = models.JSONField(default=list, blank=True)
    verification_status = models.CharField(max_length=40, blank=True)
    verification_details = models.JSONField(default=dict, blank=True)
    parsed_payload = models.JSONField(default=dict, blank=True)
    last_error = models.TextField(blank=True)
    retry_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_time_utc", "-created_at"]
        indexes = [
            models.Index(fields=["maintenance_id"], name="sdtq_maint_idx"),
            models.Index(fields=["status"], name="sdtq_status_idx"),
            models.Index(fields=["start_time_utc"], name="sdtq_start_idx"),
            models.Index(fields=["end_time_utc"], name="sdtq_end_idx"),
            models.Index(fields=["vendor_site_code"], name="sdtq_vendor_idx"),
            models.Index(fields=["lm_site_code"], name="sdtq_lm_idx"),
        ]

    def __str__(self):
        return f"{self.maintenance_id} [{self.status}]"
