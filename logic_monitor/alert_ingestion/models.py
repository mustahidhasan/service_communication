from django.db import models


class Mailbox(models.Model):
    class IngestionMode(models.TextChoices):
        SUBSCRIPTION = "subscription", "Subscription"
        POLLING = "polling", "Polling"

    name = models.CharField(max_length=120)
    address = models.EmailField(unique=True)
    ingestion_mode = models.CharField(
        max_length=20, choices=IngestionMode.choices, default=IngestionMode.SUBSCRIPTION
    )
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


class ParsingRule(models.Model):
    name = models.CharField(max_length=140)
    is_active = models.BooleanField(default=True)
    priority = models.PositiveIntegerField(default=100)
    sender_contains = models.CharField(max_length=200, blank=True)
    subject_contains = models.CharField(max_length=200, blank=True)
    body_regex = models.TextField(blank=True)
    resource_regex = models.TextField(blank=True)
    alert_name_regex = models.TextField(blank=True)
    severity_regex = models.TextField(blank=True)
    state_regex = models.TextField(blank=True)
    timestamp_regex = models.TextField(blank=True)
    severity_map = models.JSONField(default=dict, blank=True)
    state_map = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["priority", "name"]

    def __str__(self):
        return self.name


class MappingRule(models.Model):
    name = models.CharField(max_length=140)
    is_active = models.BooleanField(default=True)
    priority = models.PositiveIntegerField(default=100)
    sender_contains = models.CharField(max_length=200, blank=True)
    subject_contains = models.CharField(max_length=200, blank=True)
    body_regex = models.TextField(blank=True)
    header_regex = models.TextField(blank=True)
    resource_identifier = models.CharField(max_length=200, blank=True)
    alert_category = models.CharField(max_length=120, blank=True)
    severity_override = models.CharField(max_length=50, blank=True)
    alert_name_override = models.CharField(max_length=200, blank=True)
    source_system = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["priority", "name"]

    def __str__(self):
        return self.name


class AlertEvent(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Open"
        CLEARED = "cleared", "Cleared"
        FAILED = "failed", "Failed"

    mailbox = models.ForeignKey(Mailbox, on_delete=models.SET_NULL, null=True, blank=True)
    correlation_key = models.CharField(max_length=320, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    alert_name = models.CharField(max_length=200, blank=True)
    resource_identifier = models.CharField(max_length=200, blank=True)
    alert_category = models.CharField(max_length=120, blank=True)
    source_system = models.CharField(max_length=120, blank=True)
    severity = models.CharField(max_length=50, blank=True)
    state = models.CharField(max_length=50, blank=True)
    first_seen_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    occurrence_count = models.PositiveIntegerField(default=0)
    matched_parser_rule = models.ForeignKey(
        ParsingRule, on_delete=models.SET_NULL, null=True, blank=True
    )
    matched_mapping_rule = models.ForeignKey(
        MappingRule, on_delete=models.SET_NULL, null=True, blank=True
    )
    last_delivery_status = models.CharField(max_length=40, blank=True)
    last_email = models.ForeignKey(
        "AlertEmail", on_delete=models.SET_NULL, null=True, blank=True, related_name="latest_for"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["correlation_key", "status"]),
        ]

    def __str__(self):
        return f"{self.correlation_key} ({self.status})"


class AlertEmail(models.Model):
    mailbox = models.ForeignKey(Mailbox, on_delete=models.SET_NULL, null=True, blank=True)
    event = models.ForeignKey(
        AlertEvent, on_delete=models.SET_NULL, null=True, blank=True, related_name="emails"
    )
    message_id = models.CharField(max_length=255, blank=True)
    internet_message_id = models.CharField(max_length=255, blank=True)
    subject = models.TextField(blank=True)
    sender = models.EmailField(blank=True)
    sender_domain = models.CharField(max_length=120, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    raw_body = models.TextField(blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    parsed_resource = models.CharField(max_length=200, blank=True)
    parsed_alert_name = models.CharField(max_length=200, blank=True)
    parsed_severity = models.CharField(max_length=50, blank=True)
    parsed_state = models.CharField(max_length=50, blank=True)
    parsed_timestamp = models.DateTimeField(null=True, blank=True)
    normalized_severity = models.CharField(max_length=50, blank=True)
    normalized_state = models.CharField(max_length=50, blank=True)
    matched_parser_rule = models.ForeignKey(
        ParsingRule, on_delete=models.SET_NULL, null=True, blank=True
    )
    matched_mapping_rule = models.ForeignKey(
        MappingRule, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.subject or self.message_id}".strip()


class DeliveryAttempt(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        ACK = "ack", "Acknowledge"
        CLEAR = "clear", "Clear"

    event = models.ForeignKey(AlertEvent, on_delete=models.CASCADE, related_name="deliveries")
    email = models.ForeignKey(AlertEmail, on_delete=models.SET_NULL, null=True, blank=True)
    action = models.CharField(max_length=20, choices=Action.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    request_payload = models.JSONField(default=dict, blank=True)
    response_payload = models.JSONField(default=dict, blank=True)
    http_status = models.PositiveIntegerField(null=True, blank=True)
    attempt_count = models.PositiveIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.event_id} {self.action} ({self.status})"
