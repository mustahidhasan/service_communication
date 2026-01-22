from django.apps import AppConfig


class AlertIngestionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "alert_ingestion"
    verbose_name = "LogicMonitor Alert Ingestion"
