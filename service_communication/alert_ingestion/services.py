import json
import logging
import time
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db import transaction

from .models import AlertEmail, AlertEvent, DeliveryAttempt
from .parsing import (
    apply_parsing_rules,
    apply_mapping_rules,
    build_correlation_key,
    extract_sender_domain,
    is_domain_allowed,
)
from .logicmonitor import LogicMonitorClient

logger = logging.getLogger(__name__)


def _stringify_headers(headers):
    if headers is None:
        return {}
    if isinstance(headers, dict):
        return headers
    try:
        return json.loads(headers)
    except (ValueError, TypeError):
        return {"raw": str(headers)}


def normalize_graph_message(message):
    sender = (
        (message.get("from") or {}).get("emailAddress") or {}
    ).get("address") or ""
    subject = message.get("subject") or ""
    body = (message.get("body") or {}).get("content") or ""
    headers = message.get("internetMessageHeaders") or []
    header_dict = {}
    for header in headers:
        name = header.get("name")
        value = header.get("value")
        if name:
            header_dict[name] = value
    received_at = message.get("receivedDateTime")
    parsed_received_at = parse_datetime(received_at) if received_at else None
    return {
        "message_id": message.get("id") or "",
        "internet_message_id": message.get("internetMessageId") or "",
        "subject": subject,
        "body": body,
        "sender": sender,
        "received_at": parsed_received_at,
        "headers": header_dict,
        "raw": message,
    }


def normalize_manual_payload(payload):
    received_at = payload.get("received_at")
    parsed_received_at = parse_datetime(received_at) if isinstance(received_at, str) else received_at
    return {
        "message_id": payload.get("message_id") or "",
        "internet_message_id": payload.get("internet_message_id") or "",
        "subject": payload.get("subject") or "",
        "body": payload.get("body") or "",
        "sender": payload.get("sender") or "",
        "received_at": parsed_received_at,
        "headers": _stringify_headers(payload.get("headers")) or {},
        "raw": payload,
    }


def ingest_email_message(mailbox, payload, parser_rules, mapping_rules, trigger_delivery=True):
    message = normalize_manual_payload(payload)
    sender_domain = extract_sender_domain(message.get("sender"))
    allowed = is_domain_allowed(sender_domain, mailbox.allowlist_domains if mailbox else [])

    parsed = apply_parsing_rules(message, parser_rules)
    mapped = apply_mapping_rules(message, parsed, mapping_rules)

    correlation_key = build_correlation_key(
        mapped.get("resource_identifier"), mapped.get("alert_name"), mapped.get("source_system")
    )

    with transaction.atomic():
        alert_email = AlertEmail.objects.create(
            mailbox=mailbox,
            message_id=message.get("message_id") or "",
            internet_message_id=message.get("internet_message_id") or "",
            subject=message.get("subject") or "",
            sender=message.get("sender") or "",
            sender_domain=sender_domain,
            received_at=message.get("received_at"),
            raw_body=message.get("body") or "",
            raw_payload=message.get("raw") or {},
            parsed_resource=parsed.get("resource") or "",
            parsed_alert_name=parsed.get("alert_name") or "",
            parsed_severity=parsed.get("severity") or "",
            parsed_state=parsed.get("state") or "",
            parsed_timestamp=parsed.get("timestamp"),
            normalized_severity=parsed.get("normalized_severity") or "",
            normalized_state=parsed.get("normalized_state") or "",
            matched_parser_rule=parsed.get("matched_rule"),
            matched_mapping_rule=mapped.get("matched_rule"),
        )

        if not allowed:
            event = AlertEvent.objects.create(
                mailbox=mailbox,
                correlation_key=correlation_key,
                status=AlertEvent.Status.FAILED,
                alert_name=mapped.get("alert_name") or parsed.get("alert_name") or "",
                resource_identifier=mapped.get("resource_identifier") or parsed.get("resource") or "",
                alert_category=mapped.get("alert_category") or "",
                source_system=mapped.get("source_system") or "",
                severity=mapped.get("severity") or parsed.get("normalized_severity") or "",
                state=parsed.get("normalized_state") or "",
                matched_parser_rule=parsed.get("matched_rule"),
                matched_mapping_rule=mapped.get("matched_rule"),
                last_delivery_status="Sender domain not allowed",
                last_email=alert_email,
                first_seen_at=timezone.now(),
                last_seen_at=timezone.now(),
                occurrence_count=1,
            )
            alert_email.event = event
            alert_email.save(update_fields=["event"])
            return event, alert_email

        normalized_state = parsed.get("normalized_state")
        status = AlertEvent.Status.OPEN
        if normalized_state == "cleared":
            status = AlertEvent.Status.CLEARED
        if not normalized_state:
            status = AlertEvent.Status.FAILED

        existing_event = None
        if status in (AlertEvent.Status.OPEN, AlertEvent.Status.CLEARED):
            existing_event = (
                AlertEvent.objects.filter(correlation_key=correlation_key, status=AlertEvent.Status.OPEN)
                .order_by("-last_seen_at")
                .first()
            )

        now_ts = timezone.now()
        if existing_event and status == AlertEvent.Status.OPEN:
            existing_event.last_seen_at = now_ts
            existing_event.occurrence_count += 1
            existing_event.last_email = alert_email
            existing_event.severity = mapped.get("severity") or existing_event.severity
            existing_event.state = normalized_state or existing_event.state
            existing_event.save()
            alert_email.event = existing_event
            alert_email.save(update_fields=["event"])
            event = existing_event
        elif existing_event and status == AlertEvent.Status.CLEARED:
            existing_event.status = AlertEvent.Status.CLEARED
            existing_event.last_seen_at = now_ts
            existing_event.last_email = alert_email
            existing_event.state = normalized_state or existing_event.state
            existing_event.severity = mapped.get("severity") or existing_event.severity
            existing_event.save()
            alert_email.event = existing_event
            alert_email.save(update_fields=["event"])
            event = existing_event
        else:
            event = AlertEvent.objects.create(
                mailbox=mailbox,
                correlation_key=correlation_key,
                status=status,
                alert_name=mapped.get("alert_name") or parsed.get("alert_name") or "",
                resource_identifier=mapped.get("resource_identifier") or parsed.get("resource") or "",
                alert_category=mapped.get("alert_category") or "",
                source_system=mapped.get("source_system") or "",
                severity=mapped.get("severity") or parsed.get("normalized_severity") or "",
                state=normalized_state or "",
                matched_parser_rule=parsed.get("matched_rule"),
                matched_mapping_rule=mapped.get("matched_rule"),
                last_email=alert_email,
                first_seen_at=now_ts,
                last_seen_at=now_ts,
                occurrence_count=1,
            )
            alert_email.event = event
            alert_email.save(update_fields=["event"])

    if trigger_delivery and event.status != AlertEvent.Status.FAILED:
        deliver_event_to_logicmonitor(event, alert_email)

    return event, alert_email


def deliver_event_to_logicmonitor(event, email=None, action_override=None):
    if event is None:
        return None

    client = LogicMonitorClient()
    action = action_override
    if not action:
        action = "clear" if event.status == AlertEvent.Status.CLEARED else "create"

    payload = {
        "correlationKey": event.correlation_key,
        "resource": event.resource_identifier,
        "alertName": event.alert_name,
        "severity": event.severity,
        "state": event.state,
        "category": event.alert_category,
        "source": event.source_system,
    }

    attempt = DeliveryAttempt.objects.create(
        event=event,
        email=email,
        action=action,
        status=DeliveryAttempt.Status.PENDING,
        request_payload=payload,
        attempt_count=0,
    )

    retries = [0, 1, 2]
    response_payload = {}
    http_status = None
    status = DeliveryAttempt.Status.FAILED

    for index, delay in enumerate(retries):
        if delay:
            time.sleep(delay)
        attempt.attempt_count = index + 1
        attempt.last_attempt_at = timezone.now()
        try:
            if action == "clear":
                response = client.clear_event(payload)
            else:
                response = client.create_event(payload)
            http_status = response.status_code
            try:
                response_payload = response.json()
            except ValueError:
                response_payload = {"raw": response.text}
            if response.ok:
                status = DeliveryAttempt.Status.SUCCESS
                break
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("LogicMonitor delivery failed: %s", exc)
            response_payload = {"error": str(exc)}

    attempt.status = status
    attempt.http_status = http_status
    attempt.response_payload = response_payload
    attempt.save(update_fields=[
        "status",
        "http_status",
        "response_payload",
        "attempt_count",
        "last_attempt_at",
    ])

    event.last_delivery_status = status
    event.save(update_fields=["last_delivery_status"])
    return attempt
