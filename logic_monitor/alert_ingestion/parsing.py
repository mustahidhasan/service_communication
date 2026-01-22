import json
import re
from django.utils.dateparse import parse_datetime

SEVERITY_DEFAULTS = {
    "critical": "P1",
    "high": "P2",
    "medium": "P3",
    "low": "P4",
}

STATE_DEFAULTS = {
    "open": "open",
    "opened": "open",
    "active": "open",
    "firing": "open",
    "clear": "cleared",
    "cleared": "cleared",
    "resolved": "cleared",
    "closed": "cleared",
}


def extract_with_regex(pattern, text):
    if not pattern or not text:
        return ""
    match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
    if not match:
        return ""
    if match.groupdict():
        # Prefer first named group
        return next(iter(match.groupdict().values())) or ""
    if match.groups():
        return match.group(1) or ""
    return match.group(0) or ""


def normalize_severity(value, mapping=None):
    if not value:
        return ""
    raw = value.strip()
    mapping = mapping or {}
    if raw in mapping:
        return mapping[raw]
    lowered = raw.lower()
    if lowered in mapping:
        return mapping[lowered]
    if lowered.startswith("p") and len(lowered) <= 3:
        return lowered.upper()
    for key, normalized in SEVERITY_DEFAULTS.items():
        if key in lowered:
            return normalized
    return raw


def normalize_state(value, mapping=None):
    if not value:
        return ""
    raw = value.strip()
    mapping = mapping or {}
    if raw in mapping:
        return mapping[raw]
    lowered = raw.lower()
    if lowered in mapping:
        return mapping[lowered]
    for key, normalized in STATE_DEFAULTS.items():
        if key in lowered:
            return normalized
    return raw


def parse_timestamp(value):
    if not value:
        return None
    parsed = parse_datetime(value)
    return parsed


def rule_matches(rule, sender, subject, body, headers):
    if rule.sender_contains and rule.sender_contains.lower() not in (sender or "").lower():
        return False
    if rule.subject_contains and rule.subject_contains.lower() not in (subject or "").lower():
        return False
    if rule.body_regex and not re.search(rule.body_regex, body or "", re.IGNORECASE | re.MULTILINE):
        return False
    if rule.header_regex:
        header_text = json.dumps(headers or {}, sort_keys=True)
        if not re.search(rule.header_regex, header_text, re.IGNORECASE | re.MULTILINE):
            return False
    return True


def apply_parsing_rules(message, rules):
    sender = message.get("sender") or ""
    subject = message.get("subject") or ""
    body = message.get("body") or ""
    headers = message.get("headers") or {}
    for rule in rules:
        if not rule.is_active:
            continue
        if not rule_matches(rule, sender, subject, body, headers):
            continue
        parsed = {
            "resource": extract_with_regex(rule.resource_regex, body) or extract_with_regex(
                rule.resource_regex, subject
            ),
            "alert_name": extract_with_regex(rule.alert_name_regex, subject) or extract_with_regex(
                rule.alert_name_regex, body
            ),
            "severity": extract_with_regex(rule.severity_regex, subject) or extract_with_regex(
                rule.severity_regex, body
            ),
            "state": extract_with_regex(rule.state_regex, subject) or extract_with_regex(
                rule.state_regex, body
            ),
            "timestamp_raw": extract_with_regex(rule.timestamp_regex, body) or extract_with_regex(
                rule.timestamp_regex, subject
            ),
            "matched_rule": rule,
        }
        parsed["timestamp"] = parse_timestamp(parsed["timestamp_raw"])
        parsed["normalized_severity"] = normalize_severity(parsed.get("severity"), rule.severity_map)
        parsed["normalized_state"] = normalize_state(parsed.get("state"), rule.state_map)
        return parsed
    return {
        "resource": "",
        "alert_name": "",
        "severity": "",
        "state": "",
        "timestamp_raw": "",
        "timestamp": None,
        "normalized_severity": "",
        "normalized_state": "",
        "matched_rule": None,
    }


def apply_mapping_rules(message, parsed, rules):
    sender = message.get("sender") or ""
    subject = message.get("subject") or ""
    body = message.get("body") or ""
    headers = message.get("headers") or {}
    for rule in rules:
        if not rule.is_active:
            continue
        if not rule_matches(rule, sender, subject, body, headers):
            continue
        return {
            "resource_identifier": rule.resource_identifier or parsed.get("resource") or "",
            "alert_category": rule.alert_category or "",
            "severity": rule.severity_override or parsed.get("normalized_severity") or "",
            "alert_name": rule.alert_name_override or parsed.get("alert_name") or "",
            "source_system": rule.source_system or "",
            "matched_rule": rule,
        }
    return {
        "resource_identifier": parsed.get("resource") or "",
        "alert_category": "",
        "severity": parsed.get("normalized_severity") or "",
        "alert_name": parsed.get("alert_name") or "",
        "source_system": "",
        "matched_rule": None,
    }


def build_correlation_key(resource_identifier, alert_name, source_system):
    parts = [source_system or "unknown", resource_identifier or "unknown", alert_name or "unknown"]
    return "|".join(part.strip() for part in parts)


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
