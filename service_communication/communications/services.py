from typing import List, Tuple
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone
from django.utils.html import escape, strip_tags
from .models import IncidentMessage, DistributionList
from .constants import TEMPLATE_LOOKUP


def _list_recipients(list_obj: DistributionList) -> List[str]:
    addresses = list(list_obj.entries.values_list("email", flat=True))
    if not addresses and list_obj.email:
        addresses.append(list_obj.email)
    return addresses


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


def build_incident_message_bodies(message: IncidentMessage, raw_body: str = "") -> Tuple[str, str]:
    """Return a tuple of (text_body, html_body) using the configured template."""
    template = TEMPLATE_LOOKUP.get(message.template_type)
    if not template:
        return raw_body or message.body or "", None
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
    text_template = template.get("body") or ""
    html_template = template.get("html_body")
    text_body = text_template.format(**context)
    if html_template:
        html_body = html_template.format(**context)
    else:
        html_body = None
    if not text_template:
        text_body = raw_body or message.body or ""
    if not text_body and html_body:
        text_body = strip_tags(html_body)
    return text_body.strip(), html_body


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
