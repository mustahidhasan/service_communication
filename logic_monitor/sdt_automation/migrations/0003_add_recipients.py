from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sdt_automation", "0002_seed_data"),
    ]

    operations = [
        migrations.AddField(
            model_name="emailingested",
            name="recipients",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
