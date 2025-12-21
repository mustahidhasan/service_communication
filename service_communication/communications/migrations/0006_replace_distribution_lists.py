from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("communications", "0005_seed_email_templates"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="incident",
            name="distribution_lists",
        ),
        migrations.RemoveField(
            model_name="incident",
            name="primary_distribution_list",
        ),
        migrations.RemoveField(
            model_name="incidentmessage",
            name="distribution_list",
        ),
        migrations.RemoveField(
            model_name="incidentmessage",
            name="distribution_lists",
        ),
        migrations.DeleteModel(
            name="DistributionList",
        ),
        migrations.CreateModel(
            name="IncidentDistributionList",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("graph_id", models.CharField(max_length=255)),
                ("display_name", models.CharField(max_length=200)),
                ("email", models.EmailField(max_length=254)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "incident",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="distribution_lists",
                        to="communications.incident",
                    ),
                ),
            ],
            options={
                "ordering": ("display_name",),
                "unique_together": {("incident", "graph_id")},
            },
        ),
        migrations.AddField(
            model_name="incidentmessage",
            name="distribution_lists",
            field=models.ManyToManyField(
                blank=True,
                related_name="incident_messages",
                to="communications.incidentdistributionlist",
            ),
        ),
    ]
