from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sdt_automation", "0003_add_recipients"),
    ]

    operations = [
        migrations.AlterField(
            model_name="sdtrequest",
            name="email",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.CASCADE,
                related_name="sdt_requests",
                to="sdt_automation.emailingested",
            ),
        ),
    ]
