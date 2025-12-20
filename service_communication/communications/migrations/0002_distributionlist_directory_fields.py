from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("communications", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="distributionlist",
            name="email",
            field=models.EmailField(blank=True, default="", max_length=254),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="distributionlist",
            name="external_id",
            field=models.CharField(blank=True, max_length=255, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="distributionlist",
            name="source",
            field=models.CharField(
                choices=[
                    ("custom", "Custom"),
                    ("directory", "Active Directory"),
                ],
                db_index=True,
                default="custom",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="incidentmessage",
            name="body_html",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="incidentmessage",
            name="point_of_contact_email",
            field=models.EmailField(blank=True, default="", max_length=254),
            preserve_default=False,
        ),
    ]
