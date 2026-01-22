from django.db import migrations


def seed_rules(apps, schema_editor):
    MappingRule = apps.get_model("sdt_automation", "MappingRule")
    if not MappingRule.objects.filter(name="Example SDT mapping").exists():
        MappingRule.objects.create(
            name="Example SDT mapping",
            priority=10,
            sender_contains="@",
            subject_contains="maintenance",
            keyword_list=["DC1", "NYC"],
            target_type="group",
            target_identifiers=["123", "456"],
            notes="Sample mapping rule created by migration.",
        )


def unseed_rules(apps, schema_editor):
    MappingRule = apps.get_model("sdt_automation", "MappingRule")
    MappingRule.objects.filter(name="Example SDT mapping").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("sdt_automation", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_rules, reverse_code=unseed_rules),
    ]
