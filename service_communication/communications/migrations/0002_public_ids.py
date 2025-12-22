import uuid

from django.db import migrations, models


def populate_public_ids(apps, schema_editor):
    team_model = apps.get_model("communications", "Team")
    message_model = apps.get_model("communications", "IncidentMessage")
    attachment_model = apps.get_model("communications", "MessageAttachment")
    for model in (team_model, message_model, attachment_model):
        for entry in model.objects.filter(public_id__isnull=True):
            entry.public_id = uuid.uuid4()
            entry.save(update_fields=["public_id"])


class Migration(migrations.Migration):
    dependencies = [
        ("communications", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="team",
            name="public_id",
            field=models.UUIDField(null=True, editable=False),
        ),
        migrations.AddField(
            model_name="incidentmessage",
            name="public_id",
            field=models.UUIDField(null=True, editable=False),
        ),
        migrations.AddField(
            model_name="messageattachment",
            name="public_id",
            field=models.UUIDField(null=True, editable=False),
        ),
        migrations.RunPython(populate_public_ids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="team",
            name="public_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="incidentmessage",
            name="public_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="messageattachment",
            name="public_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
