from typing import List
from django.conf import settings
from django.core.mail import EmailMessage
from .models import IncidentMessage


def _collect_recipients(message: IncidentMessage) -> List[str]:
    recipients = []
    if message.distribution_list:
        recipients.extend(list(message.distribution_list.entries.values_list("email", flat=True)))
    if message.distribution_lists.exists():
        for dl in message.distribution_lists.all():
            recipients.extend(list(dl.entries.values_list("email", flat=True)))
    if not recipients:
        # fall back to incident defaults if nothing explicitly selected
        default_lists = message.incident.distribution_lists.all()
        for dl in default_lists:
            recipients.extend(list(dl.entries.values_list("email", flat=True)))
        if not recipients and message.incident.primary_distribution_list:
            recipients.extend(
                list(message.incident.primary_distribution_list.entries.values_list("email", flat=True))
            )
    if message.extra_recipients:
        recipients.extend([value.strip() for value in message.extra_recipients if value.strip()])
    # Deduplicate while preserving order
    seen = set()
    ordered = []
    for email in recipients:
        if email not in seen:
            seen.add(email)
            ordered.append(email)
    return ordered


def deliver_incident_message(message: IncidentMessage) -> IncidentMessage:
    """Send the provided incident message via email and update delivery metadata."""
    to_addresses = _collect_recipients(message)
    if not to_addresses:
        message.delivery_status = "skipped-no-recipients"
        message.save(update_fields=["delivery_status"])
        return message

    email = EmailMessage(
        subject=message.subject,
        body=message.body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=to_addresses,
    )

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
