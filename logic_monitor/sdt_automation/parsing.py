import re
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from django.utils import timezone as dj_timezone
from django.utils.dateparse import parse_datetime

TZ_ABBREVIATIONS = {
    "UTC": 0,
    "GMT": 0,
    "EST": -5,
    "EDT": -4,
    "CST": -6,
    "CDT": -5,
    "MST": -7,
    "MDT": -6,
    "PST": -8,
    "PDT": -7,
}

TZ_IA_TO_ABBR = {
    "America/New_York": "ET",
    "America/Chicago": "CT",
    "America/Denver": "MT",
    "America/Los_Angeles": "PT",
    "UTC": "UTC",
}

DATE_FORMATS = [
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %I:%M %p",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%y %H:%M",
    "%m/%d/%y %I:%M %p",
    "%b %d, %Y %I:%M %p",
    "%B %d, %Y %I:%M %p",
    "%b %d %Y %I:%M %p",
    "%B %d %Y %I:%M %p",
    "%d %b %Y %H:%M",
    "%d %B %Y %H:%M",
]

MAINTENANCE_PATTERNS = [
    r"\bmaintenance[\s_-]*id\s*[:#-]?\s*([A-Z0-9._-]{4,})",
    r"\bmaint[\s_-]*id\s*[:#-]?\s*([A-Z0-9._-]{4,})",
    r"\b(?:ticket|change|work[\s_-]*order)\s*[:#-]?\s*([A-Z0-9._-]{4,})",
]

VENDOR_SITE_PATTERNS = [
    r"\bvendor[\s_-]*site[\s_-]*code\s*[:#-]?\s*([A-Z0-9._-]{2,})",
    r"\bsite[\s_-]*code\s*[:#-]?\s*([A-Z0-9._-]{2,})",
    r"\bsite\s*[:#-]\s*([A-Z0-9._-]{2,})",
]

CANCELLATION_PATTERNS = [
    r"\bcancel(?:led|ed|lation)?\b",
    r"\bmaintenance\s+withdrawn\b",
    r"\bno\s+longer\s+required\b",
]


def _strip_html(value):
    if not value:
        return ""
    cleaned = re.sub(r"<[^>]+>", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _extract_timezone_token(text):
    if not text:
        return None
    match = re.search(r"\b(UTC[+-]\d{1,2}|GMT[+-]\d{1,2}|[+-]\d{2}:?\d{2}|[A-Z]{2,4})\b", text)
    if match:
        return match.group(1)
    return None


def _timezone_from_token(token, fallback_tz):
    if not token:
        return fallback_tz
    token = token.strip()
    if token in TZ_ABBREVIATIONS:
        return timezone(timedelta(hours=TZ_ABBREVIATIONS[token]))
    if token.startswith("UTC") or token.startswith("GMT"):
        offset = token[3:]
        if offset.startswith("+") or offset.startswith("-"):
            try:
                hours = int(offset)
            except ValueError:
                hours = 0
            return timezone(timedelta(hours=hours))
    if re.match(r"^[+-]\d{2}:?\d{2}$", token):
        sign = 1 if token.startswith("+") else -1
        hours = int(token[1:3])
        minutes = int(token[-2:])
        return timezone(sign * timedelta(hours=hours, minutes=minutes))
    try:
        return ZoneInfo(token)
    except Exception:  # pylint: disable=broad-except
        return fallback_tz


def _parse_datetime_value(raw, fallback_tz):
    if not raw:
        return None, ""
    raw = raw.strip()
    parsed = parse_datetime(raw)
    if parsed:
        if parsed.tzinfo is None:
            parsed = dj_timezone.make_aware(parsed, fallback_tz)
        return parsed, _extract_timezone_token(raw) or fallback_tz.tzname(None) or ""

    tz_token = _extract_timezone_token(raw)
    candidate = raw
    if tz_token:
        candidate = candidate.replace(tz_token, " ")
    candidate = re.sub(
        r"^(start|end|from|to|window|maintenance|downtime|backup)\s*[:\-]?\s*",
        "",
        candidate,
        flags=re.IGNORECASE,
    )
    candidate = re.sub(r"\bat\b", " ", candidate, flags=re.IGNORECASE)
    candidate = candidate.replace("T", " ")
    candidate = re.sub(r"\s+", " ", candidate).strip().strip(",")

    tzinfo = _timezone_from_token(tz_token, fallback_tz)
    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(candidate, fmt)
        except ValueError:
            continue
        parsed = dj_timezone.make_aware(parsed, tzinfo)
        return parsed, tz_token or tzinfo.tzname(None) or ""

    return None, tz_token or ""


def _find_line_with_keyword(text, keyword):
    if not text:
        return None
    for line in text.splitlines():
        if keyword.lower() in line.lower():
            return line.strip()
    return None


def _parse_time_range(text, fallback_tz):
    if not text:
        return None, None, ""

    range_match = re.search(
        r"\b(from|window|maintenance|downtime)[^\n]*?\b(?P<start>[^\n]+?)\b(to|until|-)\b\s*(?P<end>[^\n]+)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if range_match:
        start_raw = range_match.group("start")
        end_raw = range_match.group("end")
        start_dt, start_tz = _parse_datetime_value(start_raw, fallback_tz)
        end_dt, end_tz = _parse_datetime_value(end_raw, fallback_tz)
        tz = start_tz or end_tz
        return start_dt, end_dt, tz

    line_start = _find_line_with_keyword(text, "start")
    line_end = _find_line_with_keyword(text, "end")
    if line_start and line_end:
        if line_start == line_end:
            combined_match = re.search(
                r"start\s*[:\-]?\s*(?P<start>.+?)\b(end|until|to)\b\s*(?P<end>.+)",
                line_start,
                re.IGNORECASE,
            )
            if combined_match:
                start_dt, start_tz = _parse_datetime_value(combined_match.group("start"), fallback_tz)
                end_dt, end_tz = _parse_datetime_value(combined_match.group("end"), fallback_tz)
                tz = start_tz or end_tz
                return start_dt, end_dt, tz
        start_dt, start_tz = _parse_datetime_value(line_start, fallback_tz)
        end_dt, end_tz = _parse_datetime_value(line_end, fallback_tz)
        tz = start_tz or end_tz
        return start_dt, end_dt, tz

    return None, None, ""


def _parse_backup_window(text, fallback_tz):
    if not text:
        return None, None, ""
    backup_line = _find_line_with_keyword(text, "backup")
    if not backup_line:
        return None, None, ""
    start_dt, end_dt, tz = _parse_time_range(backup_line, fallback_tz)
    return start_dt, end_dt, tz


def _extract_first_match(text, patterns):
    if not text:
        return ""
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return (match.group(1) or "").strip()
    return ""


def _is_cancellation_intent(text):
    if not text:
        return False
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in CANCELLATION_PATTERNS)


def parse_email(subject, body_text, body_html, default_timezone=None):
    merged_text = "\n".join(filter(None, [subject or "", body_text or "", _strip_html(body_html or "")]))
    fallback_tz = default_timezone or dj_timezone.get_default_timezone()

    start_at, end_at, tz = _parse_time_range(merged_text, fallback_tz)
    backup_start_at, backup_end_at, backup_tz = _parse_backup_window(merged_text, fallback_tz)

    timezone_label = tz
    if not timezone_label and isinstance(fallback_tz, ZoneInfo):
        timezone_label = TZ_IA_TO_ABBR.get(fallback_tz.key, fallback_tz.key)
    elif not timezone_label:
        timezone_label = fallback_tz.tzname(None) or ""

    if backup_start_at or backup_end_at:
        backup_note = "Backup window detected and ignored for SDT creation."
    else:
        backup_note = ""

    notes = " ".join(part for part in [backup_note] if part).strip()

    maintenance_id = _extract_first_match(merged_text, MAINTENANCE_PATTERNS)
    vendor_site_code = _extract_first_match(merged_text, VENDOR_SITE_PATTERNS)
    cancellation_intent = _is_cancellation_intent(merged_text)

    start_utc = start_at.astimezone(timezone.utc).isoformat() if start_at else ""
    end_utc = end_at.astimezone(timezone.utc).isoformat() if end_at else ""

    return {
        "title": (subject or "").strip()[:255],
        "summary": (body_text or _strip_html(body_html or "")).strip()[:500],
        "start_at": start_at,
        "end_at": end_at,
        "timezone": timezone_label or "",
        "notes": notes,
        "backup_start_at": backup_start_at,
        "backup_end_at": backup_end_at,
        "backup_timezone": backup_tz or "",
        "extracted_fields": {
            "start_raw": start_at.isoformat() if start_at else "",
            "end_raw": end_at.isoformat() if end_at else "",
            "backup_start_raw": backup_start_at.isoformat() if backup_start_at else "",
            "backup_end_raw": backup_end_at.isoformat() if backup_end_at else "",
            "maintenance_id": maintenance_id,
            "vendor_site_code": vendor_site_code,
            "is_cancellation": cancellation_intent,
            "start_time_utc": start_utc,
            "end_time_utc": end_utc,
        },
    }
