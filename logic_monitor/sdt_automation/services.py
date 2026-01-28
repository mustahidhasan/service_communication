import hashlib
import json
import logging
import time
import re
from datetime import datetime
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .logicmonitor import LogicMonitorClient
from .models import EmailIngested, ParseResult, MappingResult, SDTRequest
from .parsing import parse_email

logger = logging.getLogger(__name__)

TARGET_TYPE_MAP = {
    "device": ("DeviceSDT", "deviceId"),
    "device_group": ("DeviceGroupSDT", "deviceGroupId"),
    "service": ("ServiceSDT", "serviceId"),
}


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
                "type": rule.target_type or "device",
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
        return "device_group"
    return normalized


def _datetime_to_epoch_ms(value):
    if not value:
        return None
    if isinstance(value, datetime) and timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_default_timezone())
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
    return parsed


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


def _build_sdt_comment(parse_result, email, override_comment=None):
    if override_comment:
        return override_comment
    start_at = parse_result.start_at
    end_at = parse_result.end_at
    notes = (
        f"Email: {email.subject or 'Maintenance notice'} | Sender: {email.sender} | "
        f"Message ID: {email.provider_message_id}"
    )
    notes = f"{notes}\nWindow: {start_at} -> {end_at} ({parse_result.timezone or 'UTC'})"
    if parse_result.notes:
        notes = f"{notes}\n{parse_result.notes}"
    return notes


def _build_sdt_payload(start_ms, end_ms, comment, target_type, target_id):
    normalized_type = normalize_target_type(target_type)
    lm_type, lm_id_field = TARGET_TYPE_MAP.get(normalized_type, TARGET_TYPE_MAP["device"])
    payload = {
        "type": lm_type,
        lm_id_field: str(target_id),
        "startDateTime": start_ms,
        "endDateTime": end_ms,
        "comment": comment or "",
        "sdtType": 1,
    }
    return payload


def _build_email_sdt_payload(parse_result, target_type, target_id, email):
    start_at = parse_result.start_at
    end_at = parse_result.end_at
    start_ms = _datetime_to_epoch_ms(start_at)
    end_ms = _datetime_to_epoch_ms(end_at)
    comment = _build_sdt_comment(parse_result, email)
    return _build_sdt_payload(start_ms, end_ms, comment, target_type, target_id)


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

    payload = _build_sdt_payload(start_ms, end_ms, comment, target_type, target_id)
    logger.info(
        "SDT create attempt ref=%s target_type=%s target_id=%s",
        correlation_ref,
        target_type,
        target_id,
    )
    if existing:
        request = existing
        request.payload = payload
        request.lm_status = SDTRequest.Status.PENDING
        request.lm_error = ""
        if email and request.email_id != email.id:
            request.email = email
        request.save(update_fields=["payload", "lm_status", "lm_error", "email", "updated_at"])
    else:
        request = SDTRequest.objects.create(
            email=email,
            correlation_key=correlation_key,
            payload=payload,
            lm_status=SDTRequest.Status.PENDING,
        )

    client = LogicMonitorClient()
    response_payload = {}
    http_status = None
    status = SDTRequest.Status.FAILED
    error_detail = ""

    for attempt, delay in enumerate([0, 1, 2, 4], start=1):
        if delay:
            time.sleep(delay)
        try:
            response = client.create_sdt(payload)
            http_status = response.status_code
            try:
                response_payload = response.json()
            except ValueError:
                response_payload = {"raw": response.text}
            if response.ok:
                status = SDTRequest.Status.SUCCESS
                break
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("LogicMonitor SDT creation failed: %s", exc)
            response_payload = {"error": str(exc)}
            error_detail = str(exc)

    if status != SDTRequest.Status.SUCCESS:
        error_detail = error_detail or _extract_error_detail(response_payload) or "LogicMonitor SDT request failed"

    request.lm_status = status
    request.lm_error = error_detail
    request.payload = {
        **payload,
        "response": response_payload,
        "http_status": http_status,
    }
    if isinstance(response_payload, dict):
        request.lm_sdt_id = str(response_payload.get("id") or response_payload.get("sdtId") or "")
    request.save(update_fields=["lm_status", "lm_error", "payload", "lm_sdt_id", "updated_at"])

    logger.info(
        "SDT request %s status=%s email=%s target=%s",
        request.id,
        request.lm_status,
        email.provider_message_id if email else "",
        target_id,
    )

    return request, True


def create_sdt_requests_for_email(email, parse_result, mapping_targets, force=False):
    requests = []
    correlation_ref = email.internet_message_id or email.provider_message_id
    start_ms = _datetime_to_epoch_ms(parse_result.start_at)
    end_ms = _datetime_to_epoch_ms(parse_result.end_at)
    comment = _build_sdt_comment(parse_result, email)

    for target in mapping_targets:
        target_type = normalize_target_type(target.get("type"))
        target_id = target.get("identifier")
        if not target_id:
            continue
        request, _ = create_sdt_request(
            correlation_ref,
            target_type,
            target_id,
            start_ms,
            end_ms,
            comment,
            email=email,
            force=force,
        )
        requests.append(request)
    return requests


def replay_failed_sdt_for_email(email, mapping_rules, force=False):
    if not email.parse_result or not email.mapping_result:
        return reprocess_email(email, mapping_rules)

    parse_result = email.parse_result
    mapping_result = email.mapping_result
    targets = mapping_result.targets or []
    if not targets:
        return email, parse_result, mapping_result

    correlation_ref = email.internet_message_id or email.provider_message_id
    start_ms = _datetime_to_epoch_ms(parse_result.start_at)
    end_ms = _datetime_to_epoch_ms(parse_result.end_at)
    comment = _build_sdt_comment(parse_result, email)
    replayed = []
    current_requests = []

    for target in targets:
        target_type = normalize_target_type(target.get("type"))
        target_id = target.get("identifier")
        if not target_id:
            continue
        correlation_key = _build_correlation_key(
            correlation_ref, target_type, str(target_id), start_ms, end_ms
        )
        existing = SDTRequest.objects.filter(correlation_key=correlation_key).first()
        if existing:
            if not force and existing.lm_status != SDTRequest.Status.FAILED:
                continue
            if force and existing.lm_status == SDTRequest.Status.SUCCESS:
                continue
        elif not force:
            continue
        request, _ = create_sdt_request(
            correlation_ref,
            target_type,
            target_id,
            start_ms,
            end_ms,
            comment,
            email=email,
        )
        replayed.append(request)
        current_requests.append(request)

    if not current_requests:
        current_requests = list(SDTRequest.objects.filter(email=email))

    if current_requests:
        if all(req.lm_status == SDTRequest.Status.SUCCESS for req in current_requests):
            email.status = EmailIngested.Status.SDT_CREATED
            email.status_detail = "SDT created"
        elif any(req.lm_status == SDTRequest.Status.FAILED for req in current_requests):
            email.status = EmailIngested.Status.FAILED
            email.status_detail = "; ".join(
                error for error in (req.lm_error for req in current_requests) if error
            ) or "SDT creation failed"
        email.save(update_fields=["status", "status_detail"])

    return email, parse_result, mapping_result


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
    start_ms = _datetime_to_epoch_ms(start_at)
    end_ms = _datetime_to_epoch_ms(end_at)
    return {
        "target_type": target_type,
        "target_id": str(target_id),
        "comment": comment,
        "start_ms": start_ms,
        "end_ms": end_ms,
    }


def ingest_email_message(mailbox, payload, mapping_rules, force=False):
    start_clock = time.monotonic()
    message = normalize_manual_payload(payload)
    message_id = message.get("message_id") or _build_fallback_message_id(message)
    sender_domain = extract_sender_domain(message.get("sender"))
    allowlist = (mailbox.allowlist_domains if mailbox else []) or settings.ALLOWED_SENDER_DOMAINS
    allowed = is_domain_allowed(sender_domain, allowlist)
    logger.info("SDT ingest start message_id=%s sender=%s", message_id, message.get("sender"))

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
            logger.info(
                "SDT ingest skipped message_id=%s status=duplicate",
                email.provider_message_id,
            )
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
            "SDT parse message_id=%s status=%s start=%s end=%s",
            email.provider_message_id,
            parse_result.parse_status,
            parse_result.start_at,
            parse_result.end_at,
        )

        mapping_payload = apply_mapping_rules(message, mapping_rules)
        mapping_result, _ = MappingResult.objects.update_or_create(
            email=email,
            defaults={
                "targets": mapping_payload.get("targets") or [],
                "matched_rules": mapping_payload.get("matched_rules") or [],
                "mapping_status": mapping_payload.get("mapping_status") or MappingResult.Status.NEEDS_MAPPING,
            },
        )
        logger.info(
            "SDT mapping message_id=%s status=%s targets=%s",
            email.provider_message_id,
            mapping_result.mapping_status,
            len(mapping_result.targets or []),
        )

        if not allowed:
            email.status = EmailIngested.Status.FAILED
            email.status_detail = "Sender domain not allowed"
            email.save(update_fields=["status", "status_detail"])
            logger.warning(
                "SDT ingest blocked message_id=%s reason=sender_not_allowed",
                email.provider_message_id,
            )
            return email, parse_result, mapping_result

        if parse_status == ParseResult.Status.FAILED:
            email.status = EmailIngested.Status.FAILED
            email.status_detail = parse_error
            email.save(update_fields=["status", "status_detail"])
            logger.warning(
                "SDT ingest failed message_id=%s reason=parse_error",
                email.provider_message_id,
            )
            return email, parse_result, mapping_result

        if mapping_result.mapping_status == MappingResult.Status.NEEDS_MAPPING:
            email.status = EmailIngested.Status.NEEDS_MAPPING
            email.status_detail = "Target mapping required"
            email.save(update_fields=["status", "status_detail"])
            logger.info(
                "SDT ingest needs_mapping message_id=%s",
                email.provider_message_id,
            )
            return email, parse_result, mapping_result

        email.status = EmailIngested.Status.MAPPED
        email.status_detail = "Targets resolved"
        email.save(update_fields=["status", "status_detail"])

    sdt_requests = create_sdt_requests_for_email(email, parse_result, mapping_result.targets)
    if not sdt_requests:
        email.status = EmailIngested.Status.FAILED
        email.status_detail = "No SDT targets to create."
    elif all(request.lm_status == SDTRequest.Status.SUCCESS for request in sdt_requests):
        email.status = EmailIngested.Status.SDT_CREATED
        email.status_detail = "SDT created"
    else:
        failed = [request for request in sdt_requests if request.lm_status == SDTRequest.Status.FAILED]
        email.status = EmailIngested.Status.FAILED
        email.status_detail = "; ".join(
            error for error in (req.lm_error for req in failed) if error
        ) or "SDT creation failed"
    email.save(update_fields=["status", "status_detail"])

    logger.info(
        "SDT ingest message_id=%s status=%s parse=%s mapping=%s sdt=%s latency_ms=%s",
        email.provider_message_id,
        email.status,
        parse_result.parse_status if parse_result else "n/a",
        mapping_result.mapping_status if mapping_result else "n/a",
        ",".join({request.lm_status for request in sdt_requests}) if sdt_requests else "n/a",
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
