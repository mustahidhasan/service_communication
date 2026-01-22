import hashlib
import json
import logging
import time
import re
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .logicmonitor import LogicMonitorClient
from .models import EmailIngested, ParseResult, MappingResult, SDTRequest
from .parsing import parse_email

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


def _build_sdt_payload(parse_result, mapping_targets, email):
    start_at = parse_result.start_at
    end_at = parse_result.end_at
    notes = (
        f"Email: {email.subject or 'Maintenance notice'} | Sender: {email.sender} | "
        f"Message ID: {email.provider_message_id}"
    )
    notes = f"{notes}\nWindow: {start_at} -> {end_at} ({parse_result.timezone or 'UTC'})"
    if parse_result.notes:
        notes = f"{notes}\n{parse_result.notes}"

    payload = {
        "startDateTime": int(start_at.timestamp() * 1000),
        "endDateTime": int(end_at.timestamp() * 1000),
        "timezone": parse_result.timezone or "UTC",
        "comment": notes,
        "sdtType": "oneTime",
    }

    device_ids = []
    group_ids = []
    for target in mapping_targets:
        target_type = (target.get("type") or "device").lower()
        identifier = target.get("identifier")
        if not identifier:
            continue
        if target_type in ("group", "site", "device_group"):
            group_ids.append(identifier)
        else:
            device_ids.append(identifier)

    if device_ids:
        payload["deviceIds"] = list(dict.fromkeys(device_ids))
    if group_ids:
        payload["deviceGroupIds"] = list(dict.fromkeys(group_ids))

    return payload


def _build_correlation_key(message_id, parse_result, targets):
    target_key = "|".join(
        sorted(
            f"{target.get('type')}:{target.get('identifier')}" for target in targets if target.get("identifier")
        )
    )
    raw = f"{message_id}|{parse_result.start_at}|{parse_result.end_at}|{target_key}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_sdt_for_email(email, parse_result, mapping_targets):
    correlation_key = _build_correlation_key(email.provider_message_id, parse_result, mapping_targets)
    existing = SDTRequest.objects.filter(correlation_key=correlation_key).first()
    if existing and existing.lm_status == SDTRequest.Status.SUCCESS:
        return existing, False

    payload = _build_sdt_payload(parse_result, mapping_targets, email)
    if existing:
        request = existing
        request.payload = payload
        request.lm_status = SDTRequest.Status.PENDING
        request.lm_error = ""
        request.save(update_fields=["payload", "lm_status", "lm_error", "updated_at"])
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
        error_detail = error_detail or response_payload.get("error") or "LogicMonitor SDT request failed"

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
        "SDT request %s status=%s email=%s",
        request.id,
        request.lm_status,
        email.provider_message_id,
    )

    return request, True


def ingest_email_message(mailbox, payload, mapping_rules, force=False):
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

        mapping_payload = apply_mapping_rules(message, mapping_rules)
        mapping_result, _ = MappingResult.objects.update_or_create(
            email=email,
            defaults={
                "targets": mapping_payload.get("targets") or [],
                "matched_rules": mapping_payload.get("matched_rules") or [],
                "mapping_status": mapping_payload.get("mapping_status") or MappingResult.Status.NEEDS_MAPPING,
            },
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

    sdt_request, created_request = create_sdt_for_email(email, parse_result, mapping_result.targets)
    if sdt_request.lm_status == SDTRequest.Status.SUCCESS:
        email.status = EmailIngested.Status.SDT_CREATED
        email.status_detail = "SDT created"
    else:
        email.status = EmailIngested.Status.FAILED
        email.status_detail = sdt_request.lm_error or "SDT creation failed"
    email.save(update_fields=["status", "status_detail"])

    logger.info(
        "SDT ingest message_id=%s status=%s parse=%s mapping=%s sdt=%s latency_ms=%s",
        email.provider_message_id,
        email.status,
        parse_result.parse_status if parse_result else "n/a",
        mapping_result.mapping_status if mapping_result else "n/a",
        sdt_request.lm_status if sdt_request else "n/a",
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
