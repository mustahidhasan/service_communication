import time
import logging
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.conf import settings

from sdt_automation.models import MailboxConfig, MappingRule
from sdt_automation.ms_graph import fetch_messages, GraphConfigurationError
from sdt_automation.services import normalize_graph_message, ingest_email_message

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Poll LogicMonitor SDT mailboxes and ingest maintenance emails."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Run a single poll cycle and exit.")
        parser.add_argument(
            "--interval",
            type=int,
            default=None,
            help="Polling interval in seconds (overrides POLL_INTERVAL_SECONDS).",
        )

    def handle(self, *args, **options):
        interval = options.get("interval") or settings.POLL_INTERVAL_SECONDS
        run_once = options.get("once")
        while True:
            self.poll_mailboxes()
            if run_once:
                break
            self.stdout.write(self.style.NOTICE(f"Sleeping {interval} seconds"))
            time.sleep(interval)

    def poll_mailboxes(self):
        mailboxes = MailboxConfig.objects.filter(is_active=True)
        mapping_rules = MappingRule.objects.filter(is_active=True)
        for mailbox in mailboxes:
            if mailbox.ingestion_mode != MailboxConfig.IngestionMode.POLL:
                continue
            user_id = mailbox.address
            since = mailbox.last_polled_at
            try:
                messages = fetch_messages(user_id, since=since.isoformat() if since else None)
            except GraphConfigurationError as exc:
                logger.warning("Graph configuration issue: %s", exc)
                continue
            except Exception as exc:  # pylint: disable=broad-except
                logger.exception("Graph polling failed: %s", exc)
                continue
            processed = 0
            for message in messages:
                try:
                    normalized = normalize_graph_message(message)
                    ingest_email_message(mailbox, normalized, mapping_rules)
                    processed += 1
                except Exception as exc:  # pylint: disable=broad-except
                    logger.exception("Failed to ingest message for %s: %s", mailbox.address, exc)
            mailbox.last_polled_at = timezone.now()
            mailbox.last_sync_at = mailbox.last_polled_at
            mailbox.save(update_fields=["last_polled_at", "last_sync_at"])
            logger.info("Mailbox %s processed %s messages", mailbox.address, processed)
