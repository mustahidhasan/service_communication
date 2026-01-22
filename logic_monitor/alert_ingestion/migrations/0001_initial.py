from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Mailbox",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                ("address", models.EmailField(max_length=254, unique=True)),
                (
                    "ingestion_mode",
                    models.CharField(
                        choices=[("subscription", "Subscription"), ("polling", "Polling")],
                        default="subscription",
                        max_length=20,
                    ),
                ),
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
                ("header_regex", models.TextField(blank=True)),
                ("resource_identifier", models.CharField(blank=True, max_length=200)),
                ("alert_category", models.CharField(blank=True, max_length=120)),
                ("severity_override", models.CharField(blank=True, max_length=50)),
                ("alert_name_override", models.CharField(blank=True, max_length=200)),
                ("source_system", models.CharField(blank=True, max_length=120)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["priority", "name"]},
        ),
        migrations.CreateModel(
            name="ParsingRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=140)),
                ("is_active", models.BooleanField(default=True)),
                ("priority", models.PositiveIntegerField(default=100)),
                ("sender_contains", models.CharField(blank=True, max_length=200)),
                ("subject_contains", models.CharField(blank=True, max_length=200)),
                ("body_regex", models.TextField(blank=True)),
                ("resource_regex", models.TextField(blank=True)),
                ("alert_name_regex", models.TextField(blank=True)),
                ("severity_regex", models.TextField(blank=True)),
                ("state_regex", models.TextField(blank=True)),
                ("timestamp_regex", models.TextField(blank=True)),
                ("severity_map", models.JSONField(blank=True, default=dict)),
                ("state_map", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["priority", "name"]},
        ),
        migrations.CreateModel(
            name="AlertEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("correlation_key", models.CharField(db_index=True, max_length=320)),
                (
                    "status",
                    models.CharField(
                        choices=[("open", "Open"), ("cleared", "Cleared"), ("failed", "Failed")],
                        default="open",
                        max_length=20,
                    ),
                ),
                ("alert_name", models.CharField(blank=True, max_length=200)),
                ("resource_identifier", models.CharField(blank=True, max_length=200)),
                ("alert_category", models.CharField(blank=True, max_length=120)),
                ("source_system", models.CharField(blank=True, max_length=120)),
                ("severity", models.CharField(blank=True, max_length=50)),
                ("state", models.CharField(blank=True, max_length=50)),
                ("first_seen_at", models.DateTimeField(blank=True, null=True)),
                ("last_seen_at", models.DateTimeField(blank=True, null=True)),
                ("occurrence_count", models.PositiveIntegerField(default=0)),
                ("last_delivery_status", models.CharField(blank=True, max_length=40)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "mailbox",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="alert_ingestion.mailbox"),
                ),
                (
                    "matched_mapping_rule",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="alert_ingestion.mappingrule"),
                ),
                (
                    "matched_parser_rule",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="alert_ingestion.parsingrule"),
                ),
            ],
            options={
                "indexes": [models.Index(fields=["correlation_key", "status"], name="alert_inge_correl_e91a5b_idx")],
            },
        ),
        migrations.CreateModel(
            name="AlertEmail",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("message_id", models.CharField(blank=True, max_length=255)),
                ("internet_message_id", models.CharField(blank=True, max_length=255)),
                ("subject", models.TextField(blank=True)),
                ("sender", models.EmailField(blank=True, max_length=254)),
                ("sender_domain", models.CharField(blank=True, max_length=120)),
                ("received_at", models.DateTimeField(blank=True, null=True)),
                ("raw_body", models.TextField(blank=True)),
                ("raw_payload", models.JSONField(blank=True, default=dict)),
                ("parsed_resource", models.CharField(blank=True, max_length=200)),
                ("parsed_alert_name", models.CharField(blank=True, max_length=200)),
                ("parsed_severity", models.CharField(blank=True, max_length=50)),
                ("parsed_state", models.CharField(blank=True, max_length=50)),
                ("parsed_timestamp", models.DateTimeField(blank=True, null=True)),
                ("normalized_severity", models.CharField(blank=True, max_length=50)),
                ("normalized_state", models.CharField(blank=True, max_length=50)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "event",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="emails", to="alert_ingestion.alertevent"),
                ),
                (
                    "mailbox",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="alert_ingestion.mailbox"),
                ),
                (
                    "matched_mapping_rule",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="alert_ingestion.mappingrule"),
                ),
                (
                    "matched_parser_rule",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="alert_ingestion.parsingrule"),
                ),
            ],
        ),
        migrations.CreateModel(
            name="DeliveryAttempt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "action",
                    models.CharField(
                        choices=[("create", "Create"), ("update", "Update"), ("ack", "Acknowledge"), ("clear", "Clear")],
                        max_length=20,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("success", "Success"), ("failed", "Failed")],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("request_payload", models.JSONField(blank=True, default=dict)),
                ("response_payload", models.JSONField(blank=True, default=dict)),
                ("http_status", models.PositiveIntegerField(blank=True, null=True)),
                ("attempt_count", models.PositiveIntegerField(default=0)),
                ("last_attempt_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "email",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="alert_ingestion.alertemail"),
                ),
                (
                    "event",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="deliveries", to="alert_ingestion.alertevent"),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddField(
            model_name="alertevent",
            name="last_email",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="latest_for", to="alert_ingestion.alertemail"),
        ),
    ]
