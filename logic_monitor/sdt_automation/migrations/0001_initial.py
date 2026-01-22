from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="MailboxConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("address", models.EmailField(max_length=254, unique=True)),
                (
                    "ingestion_mode",
                    models.CharField(
                        choices=[("poll", "Poll"), ("webhook", "Webhook")],
                        default="poll",
                        max_length=20,
                    ),
                ),
                ("polling_interval_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("is_active", models.BooleanField(default=True)),
                ("allowlist_domains", models.JSONField(blank=True, default=list)),
                ("graph_subscription_id", models.CharField(blank=True, max_length=255)),
                ("graph_subscription_secret", models.CharField(blank=True, max_length=255)),
                ("graph_subscription_expires_at", models.DateTimeField(blank=True, null=True)),
                ("last_polled_at", models.DateTimeField(blank=True, null=True)),
                ("last_sync_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name="MappingRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=140)),
                ("is_active", models.BooleanField(default=True)),
                ("priority", models.PositiveIntegerField(default=100)),
                ("sender_contains", models.CharField(blank=True, max_length=200)),
                ("subject_contains", models.CharField(blank=True, max_length=200)),
                ("body_regex", models.TextField(blank=True)),
                ("keyword_list", models.JSONField(blank=True, default=list)),
                ("target_type", models.CharField(default="device", max_length=40)),
                ("target_identifiers", models.JSONField(blank=True, default=list)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["priority", "name"]},
        ),
        migrations.CreateModel(
            name="EmailIngested",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "provider_message_id",
                    models.CharField(max_length=255, unique=True),
                ),
                ("internet_message_id", models.CharField(blank=True, max_length=255)),
                ("subject", models.TextField(blank=True)),
                ("sender", models.EmailField(blank=True, max_length=254)),
                ("sender_domain", models.CharField(blank=True, max_length=120)),
                ("received_at", models.DateTimeField(blank=True, null=True)),
                ("headers", models.JSONField(blank=True, default=dict)),
                ("body_text", models.TextField(blank=True)),
                ("body_html", models.TextField(blank=True)),
                ("attachments_metadata", models.JSONField(blank=True, default=list)),
                ("raw_payload", models.JSONField(blank=True, default=dict)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("ingested", "Ingested"),
                            ("parsed", "Parsed"),
                            ("needs_mapping", "Needs mapping"),
                            ("mapped", "Mapped"),
                            ("sdt_created", "SDT created"),
                            ("failed", "Failed"),
                            ("ignored", "Ignored"),
                        ],
                        default="ingested",
                        max_length=30,
                    ),
                ),
                ("status_detail", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "mailbox",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="sdt_automation.mailboxconfig"),
                ),
            ],
        ),
        migrations.CreateModel(
            name="ParseResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(blank=True, max_length=255)),
                ("summary", models.TextField(blank=True)),
                ("start_at", models.DateTimeField(blank=True, null=True)),
                ("end_at", models.DateTimeField(blank=True, null=True)),
                ("timezone", models.CharField(blank=True, max_length=64)),
                ("notes", models.TextField(blank=True)),
                ("backup_start_at", models.DateTimeField(blank=True, null=True)),
                ("backup_end_at", models.DateTimeField(blank=True, null=True)),
                ("backup_timezone", models.CharField(blank=True, max_length=64)),
                (
                    "parse_status",
                    models.CharField(
                        choices=[("parsed", "Parsed"), ("failed", "Failed")],
                        default="parsed",
                        max_length=20,
                    ),
                ),
                ("parse_error", models.TextField(blank=True)),
                ("extracted_fields", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "email",
                    models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="parse_result", to="sdt_automation.emailingested"),
                ),
            ],
        ),
        migrations.CreateModel(
            name="MappingResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("targets", models.JSONField(blank=True, default=list)),
                ("matched_rules", models.JSONField(blank=True, default=list)),
                (
                    "mapping_status",
                    models.CharField(
                        choices=[
                            ("mapped", "Mapped"),
                            ("needs_mapping", "Needs mapping"),
                            ("failed", "Failed"),
                        ],
                        default="needs_mapping",
                        max_length=30,
                    ),
                ),
                ("mapping_error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "email",
                    models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="mapping_result", to="sdt_automation.emailingested"),
                ),
            ],
        ),
        migrations.CreateModel(
            name="SDTRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("correlation_key", models.CharField(max_length=255, unique=True)),
                ("payload", models.JSONField(blank=True, default=dict)),
                (
                    "lm_status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("success", "Success"),
                            ("failed", "Failed"),
                            ("skipped", "Skipped"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("lm_sdt_id", models.CharField(blank=True, max_length=120)),
                ("lm_error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "email",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sdt_requests", to="sdt_automation.emailingested"),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
