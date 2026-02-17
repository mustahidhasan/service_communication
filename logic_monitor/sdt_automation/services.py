import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .logicmonitor import LogicMonitorClient
from .models import (
    EmailIngested,
    MappingResult,
    MappingRule,
    ParseResult,
    SDTQueueItem,
    SDTRequest,
    SiteCodeMapping,
)
from .parsing import parse_email

logger = logging.getLogger(__name__)

TARGET_TYPE_MAP = {
    "device": ("DeviceSDT", "deviceId"),
    "site": ("DeviceGroupSDT", "deviceGroupId"),
}


def _utc(value):
    if not value:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_default_timezone())
    return value.astimezone(timezone.utc)


def _stringify_headers(headers):
    if headers is None:
        return {}
    if isinstance(headers, dict):
        return headers
    try:
        return json.loads(headers)
    except (ValueError, TypeError):
        return {"raw": str(headers)}


def _build_fallback_message_id(payload):
    parts = [
        str(payload.get("subject") or ""),
        str(payload.get("sender") or ""),
        str(payload.get("received_at") or ""),
        str(payload.get("body") or ""),
    ]
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:32]


def _strip_html(value):
    if not value:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", value)
    cleaned = re.sub(r"\\s+", " ", cleaned)
    return cleaned.strip()


def extract_sender_domain(sender):
    if not sender or "@" not in sender:
        return ""
    return sender.split("@")[-1].lower()


def is_domain_allowed(sender_domain, allowlist):
    if not allowlist:
        return True
    if not sender_domain:
        return False
    allowed = [entry.lower() for entry in allowlist if isinstance(entry, str)]
    return sender_domain.lower() in allowed


def normalize_graph_message(message):
    sender = ((message.get("from") or {}).get("emailAddress") or {}).get("address") or ""
    subject = message.get("subject") or ""
    body = message.get("body") or {}
    body_content = body.get("content") or ""
    body_type = (body.get("contentType") or "").lower()
    headers = message.get("internetMessageHeaders") or []
    header_dict = {}
    for header in headers:
        name = header.get("name")
        value = header.get("value")
        if name:
            header_dict[name] = value
    received_at = message.get("receivedDateTime")
    parsed_received_at = parse_datetime(received_at) if received_at else None
    recipients = []
    for recipient in message.get("toRecipients") or []:
        address = ((recipient or {}).get("emailAddress") or {}).get("address")
        if address:
            recipients.append(address)
    return {
        "message_id": message.get("id") or "",
        "internet_message_id": message.get("internetMessageId") or "",
        "subject": subject,
        "body_text": body_content if body_type != "html" else "",
        "body_html": body_content if body_type == "html" else "",
        "sender": sender,
        "recipients": recipients,
        "received_at": parsed_received_at,
        "headers": header_dict,
        "raw": message,
    }


def normalize_manual_payload(payload):
    received_at = payload.get("received_at")
    parsed_received_at = parse_datetime(received_at) if isinstance(received_at, str) else received_at
    message_id = payload.get("message_id") or payload.get("id") or ""
    if not message_id:
        message_id = _build_fallback_message_id(payload)
    return {
        "message_id": message_id,
        "internet_message_id": payload.get("internet_message_id") or "",
        "subject": payload.get("subject") or "",
        "body_text": payload.get("body") or payload.get("body_text") or "",
        "body_html": payload.get("body_html") or "",
        "sender": payload.get("sender") or "",
        "recipients": payload.get("recipients") or payload.get("to") or [],
        "received_at": parsed_received_at,
        "headers": _stringify_headers(payload.get("headers")) or {},
        "attachments": payload.get("attachments") or [],
        "raw": payload,
    }


def apply_mapping_rules(message, rules):
    sender = message.get("sender") or ""
    subject = message.get("subject") or ""
    body = message.get("body_text") or message.get("body") or ""
    if not body and message.get("body_html"):
        body = _strip_html(message.get("body_html"))

    targets = []
    matched_rules = []

    for rule in rules:
        if not rule.is_active:
            continue
        if rule.sender_contains and rule.sender_contains.lower() not in sender.lower():
            continue
        if rule.subject_contains and rule.subject_contains.lower() not in subject.lower():
            continue
        if rule.body_regex:
            try:
                if not re.search(rule.body_regex, body, re.IGNORECASE | re.MULTILINE):
                    continue
            except re.error:
                continue
        keywords = rule.keyword_list or []
        if keywords:
            keyword_match = False
            combined_text = f"{subject}\n{body}".lower()
            for entry in keywords:
                if isinstance(entry, str) and entry.lower() in combined_text:
                    keyword_match = True
                    break
            if not keyword_match:
                continue

        matched_rules.append(rule)
        identifiers = rule.target_identifiers or []
        if isinstance(identifiers, str):
            identifiers = [identifiers]
        for identifier in identifiers:
            if not identifier:
                continue
            targets.append({
                "type": "device",
                "identifier": str(identifier),
            })

    status = MappingResult.Status.MAPPED if targets else MappingResult.Status.NEEDS_MAPPING
    return {
        "targets": targets,
        "matched_rules": [{"id": rule.id, "name": rule.name} for rule in matched_rules],
        "mapping_status": status,
    }


def normalize_target_type(value):
    if not value:
        return "device"
    normalized = str(value).strip().lower().replace("-", "_")
    if normalized in ("group", "site", "devicegroup"):
        return "site"
    return "device"


def _datetime_to_epoch_ms(value):
    value = _utc(value)
    if not value:
        return None
    return int(value.timestamp() * 1000)


def _parse_datetime_value(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        seconds = numeric / 1000 if numeric > 1e11 else numeric
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    value = str(value)
    if value.isdigit():
        numeric = float(value)
        seconds = numeric / 1000 if numeric > 1e11 else numeric
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    parsed = parse_datetime(value)
    if parsed and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_default_timezone())
    return _utc(parsed)


def _build_correlation_key(reference, target_type, target_id, start_ms, end_ms):
    raw = f"{reference}|{target_type}|{target_id}|{start_ms}|{end_ms}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _extract_error_detail(response_payload):
    if not response_payload:
        return ""
    if isinstance(response_payload, dict):
        for key in ("errorMessage", "errmsg", "message", "error"):
            value = response_payload.get(key)
            if value:
                return str(value)
        return json.dumps(response_payload)
    return str(response_payload)


def _notify_ops(subject, body):
    logger.warning("ops_notification subject=%s body=%s", subject, body)
    if settings.SDT_OPS_NOTIFICATION_EMAILS:
        try:
            send_mail(
                subject,
                body,
                settings.DEFAULT_FROM_EMAIL,
                settings.SDT_OPS_NOTIFICATION_EMAILS,
                fail_silently=True,
            )
        except Exception:
            logger.exception("Failed to send ops notification email")


def _queue_audit_payload(email, parse_result, is_cancellation):
    return {
        "message_id": email.provider_message_id,
        "internet_message_id": email.internet_message_id,
        "subject": email.subject,
        "sender": email.sender,
        "received_at": email.received_at.isoformat() if email.received_at else "",
        "is_cancellation": is_cancellation,
        "extracted_fields": parse_result.extracted_fields or {},
    }


def _resolve_mapping(vendor_site_code):
    if not vendor_site_code:
        return None
    mapping = SiteCodeMapping.objects.filter(vendor_site_code=vendor_site_code).first()
    return mapping.lm_site_code if mapping else None


def _next_retry_allowed(item):
    delay_seconds = min(300, 2 ** min(item.retry_count, 8))
    return item.updated_at + timedelta(seconds=delay_seconds)


def _verify_created(client, sdt_ids):
    details = []
    ok = True
    for sdt_id in sdt_ids:
        response = client.get_sdt(sdt_id)
        details.append({"sdt_id": sdt_id, "http_status": response.status_code})
        if not response.ok:
            ok = False
    return ok, details


def _verify_ended(client, sdt_ids):
    details = []
    ok = True
    for sdt_id in sdt_ids:
        response = client.get_sdt(sdt_id)
        details.append({"sdt_id": sdt_id, "http_status": response.status_code})
        if response.status_code not in (404, 410):
            ok = False
    return ok, details


def _detect_circuit_targets(client, item):
    devices = client.list_devices_for_site(item.lm_site_code)
    if len(devices) <= 0:
        return {
            "circuit_type": SDTQueueItem.CircuitType.UNKNOWN,
            "target_type": SDTQueueItem.TargetType.SITE,
            "target_ids": [item.lm_site_code],
            "error": "No site devices found during circuit detection",
            "meta": {"device_count": 0},
        }

    if len(devices) == 1:
        return {
            "circuit_type": SDTQueueItem.CircuitType.SINGLE,
            "target_type": SDTQueueItem.TargetType.SITE,
            "target_ids": [item.lm_site_code],
            "error": "",
            "meta": {"device_count": 1, "device_ids": [devices[0].get("id")]},
        }

    device_ids = [str(device.get("id")) for device in devices if device.get("id") is not None]
    return {
        "circuit_type": SDTQueueItem.CircuitType.DUAL,
        "target_type": SDTQueueItem.TargetType.DEVICE,
        "target_ids": device_ids,
        "error": "",
        "meta": {"device_count": len(device_ids), "device_ids": device_ids},
    }


def _create_sdt_for_target(client, item, target_type, target_id):
    lm_type, lm_id_field = TARGET_TYPE_MAP[target_type]
    payload = {
        "type": lm_type,
        lm_id_field: str(target_id),
        "startDateTime": _datetime_to_epoch_ms(item.start_time_utc),
        "endDateTime": _datetime_to_epoch_ms(item.end_time_utc),
        "comment": (
            f"Maintenance {item.maintenance_id} | vendor_site={item.vendor_site_code} "
            f"| lm_site={item.lm_site_code}"
        ),
        "sdtType": 1,
    }
    response = client.create_sdt(payload)
    response_json = {}
    try:
        response_json = response.json()
    except ValueError:
        response_json = {"raw": response.text}
    sdt_id = str(response_json.get("id") or response_json.get("sdtId") or "")
    return response, response_json, sdt_id, payload


def _activate_item(item):
    now = timezone.now()
    if item.status != SDTQueueItem.Status.PENDING:
        return False
    if item.retry_count and now < _next_retry_allowed(item):
        return False

    if not item.lm_site_code:
        item.last_error = "mapping missing"
        item.save(update_fields=["last_error", "updated_at"])
        logger.warning(
            "activate_blocked maintenance_id=%s vendor_site_code=%s reason=mapping_missing",
            item.maintenance_id,
            item.vendor_site_code,
        )
        _notify_ops(
            "Mapping missing for SDT activation",
            f"maintenance_id={item.maintenance_id} vendor_site_code={item.vendor_site_code}",
        )
        return False

    client = LogicMonitorClient()
    logger.info("detect_start maintenance_id=%s lm_site_code=%s", item.maintenance_id, item.lm_site_code)
    detection = _detect_circuit_targets(client, item)
    item.circuit_type = detection["circuit_type"]
    item.target_type = detection["target_type"]
    item.target_ids = detection["target_ids"]

    if detection["error"]:
        item.retry_count += 1
        item.last_error = detection["error"]
        item.verification_status = "detect_failed"
        item.verification_details = detection.get("meta") or {}
        item.save(
            update_fields=[
                "circuit_type",
                "target_type",
                "target_ids",
                "retry_count",
                "last_error",
                "verification_status",
                "verification_details",
                "updated_at",
            ]
        )
        logger.warning(
            "detect_failed maintenance_id=%s retry_count=%s error=%s",
            item.maintenance_id,
            item.retry_count,
            detection["error"],
        )
        if item.retry_count >= 3:
            _notify_ops(
                "Repeated SDT activation failures",
                (
                    f"maintenance_id={item.maintenance_id} "
                    f"retry_count={item.retry_count} stage=circuit_detection"
                ),
            )
        return False

    if item.lm_sdt_ids:
        item.status = SDTQueueItem.Status.ACTIVE
        item.last_error = ""
        item.save(update_fields=["status", "last_error", "updated_at"])
        return True

    created_ids = []
    audit_calls = []
    for target_id in item.target_ids:
        target_type = "site" if item.target_type == SDTQueueItem.TargetType.SITE else "device"
        response, response_json, sdt_id, request_payload = _create_sdt_for_target(
            client, item, target_type, target_id
        )
        audit_calls.append(
            {
                "target_id": target_id,
                "request": request_payload,
                "response_status": response.status_code,
                "response": response_json,
            }
        )
        if response.ok and sdt_id:
            created_ids.append(sdt_id)
        logger.info(
            "activate_call maintenance_id=%s target_id=%s status=%s sdt_id=%s",
            item.maintenance_id,
            target_id,
            response.status_code,
            sdt_id,
        )

    if not created_ids:
        item.retry_count += 1
        item.last_error = "SDT activation failed"
        item.verification_status = "create_failed"
        item.verification_details = {"calls": audit_calls}
        item.save(
            update_fields=[
                "retry_count",
                "last_error",
                "verification_status",
                "verification_details",
                "updated_at",
            ]
        )
        if item.retry_count >= 3:
            _notify_ops(
                "Repeated SDT activation failures",
                f"maintenance_id={item.maintenance_id} retry_count={item.retry_count}",
            )
        return False

    verified_ok, verify_details = _verify_created(client, created_ids)
    item.status = SDTQueueItem.Status.ACTIVE
    item.lm_sdt_ids = created_ids
    item.last_error = ""
    item.verification_status = "verified" if verified_ok else "verify_failed"
    item.verification_details = {
        "calls": audit_calls,
        "circuit_detection": detection.get("meta") or {},
        "verification": verify_details,
    }
    item.save(
        update_fields=[
            "status",
            "lm_sdt_ids",
            "last_error",
            "verification_status",
            "verification_details",
            "circuit_type",
            "target_type",
            "target_ids",
            "updated_at",
        ]
    )
    logger.info(
        "activate_complete maintenance_id=%s status=%s verified=%s lm_sdt_ids=%s",
        item.maintenance_id,
        item.status,
        verified_ok,
        created_ids,
    )
    return True


def _end_item_sdts(item, destination_status):
    if not item.lm_sdt_ids:
        item.status = destination_status
        item.verification_status = "no_sdt_ids"
        item.save(update_fields=["status", "verification_status", "updated_at"])
        return True

    client = LogicMonitorClient()
    end_calls = []
    for sdt_id in item.lm_sdt_ids:
        response = client.end_sdt(sdt_id)
        end_calls.append({"sdt_id": sdt_id, "http_status": response.status_code})
        logger.info(
            "expire_call maintenance_id=%s sdt_id=%s status=%s",
            item.maintenance_id,
            sdt_id,
            response.status_code,
        )

    verified_ok, verify_details = _verify_ended(client, item.lm_sdt_ids)
    item.status = destination_status
    item.verification_status = "ended_verified" if verified_ok else "end_verify_failed"
    item.verification_details = {
        **(item.verification_details or {}),
        "end_calls": end_calls,
        "end_verification": verify_details,
    }
    if not verified_ok:
        item.retry_count += 1
        item.last_error = "SDT end verification failed"
        update_fields = [
            "status",
            "verification_status",
            "verification_details",
            "retry_count",
            "last_error",
            "updated_at",
        ]
    else:
        item.last_error = ""
        update_fields = ["status", "verification_status", "verification_details", "last_error", "updated_at"]
    item.save(update_fields=update_fields)
    logger.info(
        "expire_complete maintenance_id=%s destination_status=%s verified=%s",
        item.maintenance_id,
        destination_status,
        verified_ok,
    )
    return verified_ok


def activate_due_queue_items(now=None):
    now = now or timezone.now()
    due = SDTQueueItem.objects.filter(
        status=SDTQueueItem.Status.PENDING,
        lm_site_code__isnull=False,
        start_time_utc__lte=now + timedelta(minutes=2),
        end_time_utc__gt=now,
    )
    processed = 0
    for item in due:
        if _activate_item(item):
            processed += 1
    return processed


def expire_active_queue_items(now=None):
    now = now or timezone.now()
    active_items = SDTQueueItem.objects.filter(
        status=SDTQueueItem.Status.ACTIVE,
        end_time_utc__lte=now,
    )
    processed = 0
    for item in active_items:
        if _end_item_sdts(item, SDTQueueItem.Status.COMPLETED):
            processed += 1
    return processed


def process_queue_tick(now=None):
    now = now or timezone.now()
    activated = activate_due_queue_items(now=now)
    expired = expire_active_queue_items(now=now)
    logger.info("queue_tick activated=%s expired=%s at=%s", activated, expired, now.isoformat())
    return {"activated": activated, "expired": expired}


def _resolve_maintenance_id(parse_data, message_id, vendor_site_code, start_at):
    extracted = (parse_data.get("extracted_fields") or {}).get("maintenance_id") or ""
    if extracted:
        return extracted
    if vendor_site_code and start_at:
        return f"{vendor_site_code}-{_utc(start_at).strftime('%Y%m%d%H%M')}"
    return f"msg-{message_id}"


def _find_cancellation_target(parse_data):
    extracted = parse_data.get("extracted_fields") or {}
    maintenance_id = extracted.get("maintenance_id") or ""
    vendor_site_code = extracted.get("vendor_site_code") or ""
    start_time_utc = _parse_datetime_value(extracted.get("start_time_utc"))

    if maintenance_id:
        return SDTQueueItem.objects.filter(maintenance_id=maintenance_id).first()

    if vendor_site_code and start_time_utc:
        return SDTQueueItem.objects.filter(
            vendor_site_code=vendor_site_code,
            start_time_utc=start_time_utc,
        ).first()
    return None


def cancel_queue_item(item, reason="cancelled by email"):
    if not item:
        return None
    if item.status in {SDTQueueItem.Status.CANCELLED, SDTQueueItem.Status.COMPLETED}:
        logger.info("cancel_noop maintenance_id=%s status=%s", item.maintenance_id, item.status)
        return item
    if item.status == SDTQueueItem.Status.ACTIVE:
        _end_item_sdts(item, SDTQueueItem.Status.CANCELLED)
    else:
        item.status = SDTQueueItem.Status.CANCELLED
        item.last_error = reason
        item.save(update_fields=["status", "last_error", "updated_at"])
    logger.info("cancel_complete maintenance_id=%s status=%s", item.maintenance_id, item.status)
    return item


def replay_queue_item(item):
    if not item:
        return None
    if item.status == SDTQueueItem.Status.COMPLETED:
        return item
    lm_mapped = bool(item.lm_site_code and str(item.lm_site_code).strip())
    allowed_pending = item.status == SDTQueueItem.Status.PENDING and lm_mapped
    allowed_active = item.status == SDTQueueItem.Status.ACTIVE and bool((item.last_error or "").strip())
    if not (allowed_pending or allowed_active):
        return item
    if item.status == SDTQueueItem.Status.CANCELLED:
        item.status = SDTQueueItem.Status.PENDING
    item.last_error = ""
    item.retry_count = 0
    if item.status != SDTQueueItem.Status.ACTIVE:
        item.lm_sdt_ids = []
    item.save(update_fields=["status", "last_error", "retry_count", "lm_sdt_ids", "updated_at"])
    return item


def ingest_email_message(mailbox, payload, mapping_rules, force=False):
    del mapping_rules  # Option 2 path uses site-code mapping table.
    start_clock = time.monotonic()
    message = normalize_manual_payload(payload)
    message_id = message.get("message_id") or _build_fallback_message_id(message)
    sender_domain = extract_sender_domain(message.get("sender"))
    allowlist = (mailbox.allowlist_domains if mailbox else []) or settings.ALLOWED_SENDER_DOMAINS
    allowed = is_domain_allowed(sender_domain, allowlist)

    with transaction.atomic():
        email, created = EmailIngested.objects.get_or_create(
            provider_message_id=message_id,
            defaults={
                "mailbox": mailbox,
                "internet_message_id": message.get("internet_message_id") or "",
                "subject": message.get("subject") or "",
                "sender": message.get("sender") or "",
                "sender_domain": sender_domain,
                "recipients": message.get("recipients") or [],
                "received_at": message.get("received_at"),
                "headers": message.get("headers") or {},
                "body_text": message.get("body_text") or "",
                "body_html": message.get("body_html") or "",
                "attachments_metadata": message.get("attachments") or [],
                "raw_payload": message.get("raw") or {},
                "status": EmailIngested.Status.INGESTED,
            },
        )
        if not created and not force:
            return email, None, None

        parse_data = parse_email(
            message.get("subject"),
            message.get("body_text"),
            message.get("body_html"),
        )
        parse_status = ParseResult.Status.PARSED
        parse_error = ""
        if not parse_data.get("start_at") or not parse_data.get("end_at"):
            parse_status = ParseResult.Status.FAILED
            parse_error = "Could not extract maintenance window start/end."

        parse_result, _ = ParseResult.objects.update_or_create(
            email=email,
            defaults={
                "title": parse_data.get("title") or "",
                "summary": parse_data.get("summary") or "",
                "start_at": parse_data.get("start_at"),
                "end_at": parse_data.get("end_at"),
                "timezone": parse_data.get("timezone") or "",
                "notes": parse_data.get("notes") or "",
                "backup_start_at": parse_data.get("backup_start_at"),
                "backup_end_at": parse_data.get("backup_end_at"),
                "backup_timezone": parse_data.get("backup_timezone") or "",
                "parse_status": parse_status,
                "parse_error": parse_error,
                "extracted_fields": parse_data.get("extracted_fields") or {},
            },
        )
        logger.info(
            "parse_complete message_id=%s maintenance_id=%s vendor_site_code=%s cancellation=%s start_utc=%s end_utc=%s",
            email.provider_message_id,
            (parse_data.get("extracted_fields") or {}).get("maintenance_id") or "",
            (parse_data.get("extracted_fields") or {}).get("vendor_site_code") or "",
            bool((parse_data.get("extracted_fields") or {}).get("is_cancellation")),
            (parse_data.get("extracted_fields") or {}).get("start_time_utc") or "",
            (parse_data.get("extracted_fields") or {}).get("end_time_utc") or "",
        )

        if not allowed:
            email.status = EmailIngested.Status.FAILED
            email.status_detail = "Sender domain not allowed"
            email.save(update_fields=["status", "status_detail"])
            return email, parse_result, None

        if parse_status == ParseResult.Status.FAILED:
            email.status = EmailIngested.Status.FAILED
            email.status_detail = parse_error
            email.save(update_fields=["status", "status_detail"])
            return email, parse_result, None

        extracted = parse_data.get("extracted_fields") or {}
        is_cancellation = bool(extracted.get("is_cancellation"))
        vendor_site_code = extracted.get("vendor_site_code") or ""
        maintenance_id = _resolve_maintenance_id(
            parse_data,
            message_id,
            vendor_site_code,
            parse_data.get("start_at"),
        )

        if is_cancellation:
            target_item = _find_cancellation_target(parse_data)
            if target_item is None and maintenance_id:
                target_item = SDTQueueItem.objects.filter(maintenance_id=maintenance_id).first()
            if target_item:
                target_item.parsed_payload = {
                    **(target_item.parsed_payload or {}),
                    "cancellation": _queue_audit_payload(email, parse_result, True),
                }
                target_item.save(update_fields=["parsed_payload", "updated_at"])
                cancel_queue_item(target_item, reason="cancelled by email")
            else:
                SDTQueueItem.objects.update_or_create(
                    maintenance_id=maintenance_id,
                    defaults={
                        "vendor_site_code": vendor_site_code or "unknown",
                        "lm_site_code": _resolve_mapping(vendor_site_code) if vendor_site_code else None,
                        "start_time_utc": _utc(parse_data.get("start_at")) or timezone.now(),
                        "end_time_utc": _utc(parse_data.get("end_at")) or timezone.now(),
                        "status": SDTQueueItem.Status.CANCELLED,
                        "parsed_payload": _queue_audit_payload(email, parse_result, True),
                        "last_error": "cancelled by email before activation",
                    },
                )
            email.status = EmailIngested.Status.PARSED
            email.status_detail = "Cancellation processed"
            email.save(update_fields=["status", "status_detail"])
            mapping_result, _ = MappingResult.objects.update_or_create(
                email=email,
                defaults={
                    "targets": [],
                    "matched_rules": [{"id": "site_map", "name": "Site code mapping"}],
                    "mapping_status": MappingResult.Status.NEEDS_MAPPING,
                    "mapping_error": "",
                },
            )
            return email, parse_result, mapping_result

        lm_site_code = _resolve_mapping(vendor_site_code)
        queue_defaults = {
            "vendor_site_code": vendor_site_code or "unknown",
            "lm_site_code": lm_site_code,
            "start_time_utc": _utc(parse_data.get("start_at")),
            "end_time_utc": _utc(parse_data.get("end_at")),
            "status": SDTQueueItem.Status.PENDING,
            "parsed_payload": _queue_audit_payload(email, parse_result, False),
            "last_error": "",
        }
        queue_item, _ = SDTQueueItem.objects.update_or_create(
            maintenance_id=maintenance_id,
            defaults=queue_defaults,
        )

        mapping_result, _ = MappingResult.objects.update_or_create(
            email=email,
            defaults={
                "targets": [{"type": "site", "identifier": lm_site_code}] if lm_site_code else [],
                "matched_rules": [{"id": "site_map", "name": "Site code mapping"}],
                "mapping_status": MappingResult.Status.MAPPED if lm_site_code else MappingResult.Status.NEEDS_MAPPING,
                "mapping_error": "" if lm_site_code else "mapping missing",
            },
        )
        logger.info(
            "map_complete message_id=%s maintenance_id=%s vendor_site_code=%s lm_site_code=%s mapping_status=%s",
            email.provider_message_id,
            maintenance_id,
            vendor_site_code,
            lm_site_code or "",
            mapping_result.mapping_status,
        )

        if not lm_site_code:
            queue_item.last_error = "mapping missing"
            queue_item.save(update_fields=["last_error", "updated_at"])
            _notify_ops(
                "Mapping missing for new maintenance",
                f"maintenance_id={maintenance_id} vendor_site_code={vendor_site_code}",
            )
            email.status = EmailIngested.Status.NEEDS_MAPPING
            email.status_detail = "Mapping missing"
        else:
            email.status = EmailIngested.Status.MAPPED
            email.status_detail = "Queued for scheduler"
        email.save(update_fields=["status", "status_detail"])

    logger.info(
        "ingest_complete message_id=%s maintenance_id=%s status=%s latency_ms=%s",
        email.provider_message_id,
        maintenance_id,
        email.status,
        int((time.monotonic() - start_clock) * 1000),
    )

    return email, parse_result, mapping_result


def reprocess_email(email, mapping_rules):
    payload = {
        "message_id": email.provider_message_id,
        "internet_message_id": email.internet_message_id,
        "subject": email.subject,
        "sender": email.sender,
        "recipients": email.recipients,
        "body_text": email.body_text,
        "body_html": email.body_html,
        "received_at": email.received_at.isoformat() if email.received_at else "",
        "headers": email.headers,
        "attachments": email.attachments_metadata,
    }
    return ingest_email_message(email.mailbox, payload, mapping_rules, force=True)


def replay_failed_sdt_for_email(email, mapping_rules, force=False):
    del mapping_rules, force
    parse_result = getattr(email, "parse_result", None)
    maintenance_id = (parse_result.extracted_fields or {}).get("maintenance_id") if parse_result else ""
    if not maintenance_id and parse_result:
        maintenance_id = _resolve_maintenance_id(
            {"extracted_fields": parse_result.extracted_fields},
            email.provider_message_id,
            (parse_result.extracted_fields or {}).get("vendor_site_code") or "",
            parse_result.start_at,
        )
    item = SDTQueueItem.objects.filter(maintenance_id=maintenance_id).first()
    if item:
        replay_queue_item(item)
    return email, parse_result, getattr(email, "mapping_result", None)


def create_sdt_request(
    correlation_ref,
    target_type,
    target_id,
    start_ms,
    end_ms,
    comment,
    email=None,
    force=False,
):
    correlation_key = _build_correlation_key(correlation_ref, target_type, target_id, start_ms, end_ms)
    existing = SDTRequest.objects.filter(correlation_key=correlation_key).first()
    if existing and existing.lm_status == SDTRequest.Status.SUCCESS and not force:
        return existing, False

    lm_type, lm_id_field = TARGET_TYPE_MAP.get(normalize_target_type(target_type), TARGET_TYPE_MAP["device"])
    payload = {
        "type": lm_type,
        lm_id_field: str(target_id),
        "startDateTime": start_ms,
        "endDateTime": end_ms,
        "comment": comment,
        "sdtType": 1,
    }

    request = existing or SDTRequest.objects.create(
        email=email,
        correlation_key=correlation_key,
        payload={},
        lm_status=SDTRequest.Status.PENDING,
    )

    client = LogicMonitorClient()
    response = client.create_sdt(payload)
    try:
        response_payload = response.json()
    except ValueError:
        response_payload = {"raw": response.text}

    request.payload = {
        "request": payload,
        "response": response_payload,
        "http_status": response.status_code,
    }
    if response.ok:
        request.lm_status = SDTRequest.Status.SUCCESS
        request.lm_error = ""
        request.lm_sdt_id = str(response_payload.get("id") or response_payload.get("sdtId") or "")
    else:
        request.lm_status = SDTRequest.Status.FAILED
        request.lm_error = _extract_error_detail(response_payload) or "LogicMonitor SDT request failed"
    request.save(update_fields=["payload", "lm_status", "lm_error", "lm_sdt_id", "updated_at"])
    return request, True


def normalize_sdt_input(payload):
    target_type = normalize_target_type(payload.get("target_type"))
    target_id = payload.get("target_id")
    comment = payload.get("comment")
    start_at = _parse_datetime_value(payload.get("start_time"))
    end_at = _parse_datetime_value(payload.get("end_time"))
    if target_type not in TARGET_TYPE_MAP:
        raise ValueError("Invalid target_type.")
    if not target_id or not start_at or not end_at or comment is None or str(comment).strip() == "":
        raise ValueError("Missing required SDT fields.")
    if start_at >= end_at:
        raise ValueError("start_time must be before end_time.")
    return {
        "target_type": target_type,
        "target_id": str(target_id),
        "comment": comment,
        "start_ms": _datetime_to_epoch_ms(start_at),
        "end_ms": _datetime_to_epoch_ms(end_at),
    }
