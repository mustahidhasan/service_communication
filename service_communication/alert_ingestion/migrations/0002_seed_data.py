from django.db import migrations


def seed_rules(apps, schema_editor):
    ParsingRule = apps.get_model("alert_ingestion", "ParsingRule")
    MappingRule = apps.get_model("alert_ingestion", "MappingRule")
    if not ParsingRule.objects.filter(name="Example parser").exists():
        ParsingRule.objects.create(
            name="Example parser",
            priority=10,
            sender_contains="@",
            subject_contains="alert",
            resource_regex=r"Resource:\s*(.+)",
            alert_name_regex=r"Alert:\s*(.+)",
            severity_regex=r"Severity:\s*(.+)",
            state_regex=r"State:\s*(OPEN|CLEAR|CLEARED)",
            timestamp_regex=r"Timestamp:\s*(.+)",
            severity_map={"Critical": "P1", "High": "P2", "Medium": "P3", "Low": "P4"},
            state_map={"OPEN": "open", "CLEAR": "cleared", "CLEARED": "cleared"},
        )
    if not MappingRule.objects.filter(name="Example mapping").exists():
        MappingRule.objects.create(
            name="Example mapping",
            priority=10,
            sender_contains="@",
            subject_contains="alert",
            resource_identifier="core-switch-01",
            alert_category="email-ingest",
            severity_override="P2",
            alert_name_override="Email Alert",
            source_system="Mailbox",
            notes="Sample mapping rule created by migration.",
        )


def unseed_rules(apps, schema_editor):
    ParsingRule = apps.get_model("alert_ingestion", "ParsingRule")
    MappingRule = apps.get_model("alert_ingestion", "MappingRule")
    ParsingRule.objects.filter(name="Example parser").delete()
    MappingRule.objects.filter(name="Example mapping").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("alert_ingestion", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_rules, reverse_code=unseed_rules),
    ]
