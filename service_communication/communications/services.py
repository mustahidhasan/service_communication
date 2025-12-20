from typing import Dict, List, Optional, Tuple
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone
from django.utils.html import escape, strip_tags
from .models import IncidentMessage, DistributionList
from .template_loader import get_template_data


def _list_recipients(list_obj: DistributionList) -> List[str]:
    if list_obj.email:
        return [list_obj.email]
    return []


class _SafeContext(dict):
    def __missing__(self, key):
        return ""


def _format_value(value: Optional[str], context: dict) -> str:
    if not value:
        return ""
    try:
        return value.format_map(_SafeContext(context))
    except Exception:  # pylint: disable=broad-except
        return value or ""


def build_recipient_snapshot(message: IncidentMessage) -> List[Dict[str, Optional[str]]]:
    snapshot: List[Dict[str, Optional[str]]] = []
    serialized_lists = list(message.distribution_lists.all())
    if message.distribution_list and all(dl.id != message.distribution_list.id for dl in serialized_lists):
        serialized_lists.append(message.distribution_list)
    for dl in serialized_lists:
        if not dl:
            continue
        snapshot.append(
            {
                "type": "distribution_list",
                "id": dl.id,
                "graph_id": dl.external_id,
                "name": dl.name,
                "email": dl.email,
            }
        )
    for email in message.extra_recipients or []:
        snapshot.append({"type": "one_off", "email": email})
    return snapshot


def _collect_recipients(message: IncidentMessage) -> List[str]:
    recipients = []
    if message.distribution_list:
        recipients.extend(_list_recipients(message.distribution_list))
    if message.distribution_lists.exists():
        for dl in message.distribution_lists.all():
            recipients.extend(_list_recipients(dl))
    if not recipients:
        # fall back to incident defaults if nothing explicitly selected
        default_lists = message.incident.distribution_lists.all()
        for dl in default_lists:
            recipients.extend(_list_recipients(dl))
        if not recipients and message.incident.primary_distribution_list:
            recipients.extend(_list_recipients(message.incident.primary_distribution_list))
    if message.extra_recipients:
        recipients.extend([value.strip() for value in message.extra_recipients if value.strip()])
    # Deduplicate while preserving order
    seen = set()
    ordered = []
    for email in recipients:
        normalized = email.lower()
        if normalized not in seen:
            seen.add(normalized)
            ordered.append(email)
    return ordered


def _format_datetime(value):
    if not value:
        return ""
    localized = timezone.localtime(value)
    return localized.strftime("%d %b %Y %H:%M %Z")


def _build_notes_blocks(raw_body: str) -> Tuple[str, str]:
    if not raw_body:
        return "", ""
    lines = [line.strip() for line in raw_body.splitlines() if line.strip()]
    if not lines:
        return "", ""
    text = "Additional Details:\n" + "\n".join(lines)
    html_parts = "".join(f"<p>{escape(line)}</p>" for line in lines)
    html = (
        "<div style='margin-top:16px;'>"
        "<p style='font-weight:600;margin:0 0 4px;'>Additional Details</p>"
        f"{html_parts}"
        "</div>"
    )
    return text, html


def _render_template(template: dict, context: dict) -> Tuple[str, Optional[str]]:
    text_template = template.get("body_text") or template.get("body") or ""
    html_template = template.get("body_html") or template.get("html_body")
    text_body = _format_value(text_template, context) if text_template else ""
    html_body = _format_value(html_template, context) if html_template else None
    if not text_template:
        text_body = context.get("custom_notes") or ""
    if not text_body and html_body:
        text_body = strip_tags(html_body)
    return text_body.strip(), html_body


def build_incident_message_bodies(
    message: IncidentMessage, raw_body: str = ""
) -> Tuple[str, Optional[str], Optional[int]]:
    """Return a tuple of (text_body, html_body, template_version) using the configured template."""
    template = get_template_data(message.template_type)
    if not template:
        fallback_body = raw_body or message.body or ""
        return fallback_body, None, None
    incident = message.incident
    next_update = message.next_communication_time or incident.next_communication_time
    notes_text, notes_html = _build_notes_blocks(raw_body)
    context = {
        "incident_number": incident.inc_number or "",
        "incident_reference": incident.reference_id or "",
        "incident_title": incident.title or incident.summary or "",
        "problem": message.problem_description or incident.problem_description or incident.summary or "",
        "workaround": message.workaround or incident.workaround or "No workaround available.",
        "impact": incident.impact or "",
        "severity": incident.severity or "",
        "status": incident.status or "",
        "next_update": _format_datetime(next_update),
        "poc_name": message.point_of_contact or "",
        "poc_email": message.point_of_contact_email or "",
        "custom_notes": notes_text,
        "custom_notes_html": notes_html,
    }
    text_body, html_body = _render_template(template, context)
    if not text_body:
        text_body = raw_body or message.body or ""
    return text_body.strip(), html_body, template.get("version")


def render_template_preview(template_key: str, context: dict) -> Optional[Dict[str, Optional[str]]]:
    template = get_template_data(template_key)
    if not template:
        return None
    text_body, html_body = _render_template(template, context)
    subject = _format_value(template.get("subject"), context)
    return {
        "subject": subject,
        "body": text_body,
        "html": html_body,
        "version": template.get("version"),
    }


def deliver_incident_message(message: IncidentMessage) -> IncidentMessage:
    """Send the provided incident message via email and update delivery metadata."""
    to_addresses = _collect_recipients(message)
    if not to_addresses:
        message.delivery_status = "skipped-no-recipients"
        message.save(update_fields=["delivery_status"])
        return message

    email = EmailMultiAlternatives(
        subject=message.subject,
        body=message.body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=to_addresses,
    )
    if message.body_html:
        email.attach_alternative(message.body_html, "text/html")

    for attachment in message.attachments.all():
        email.attach_file(attachment.file.path)

    try:
        email.send(fail_silently=False)
        message.sent_to = to_addresses
        message.delivery_status = "sent"
        message.save(update_fields=["sent_to", "delivery_status"])
    except Exception as exc:  # pylint: disable=broad-except
        message.delivery_status = f"error: {exc}"
        message.save(update_fields=["delivery_status"])

    return message
