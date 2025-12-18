ANNOUNCEMENT_TEMPLATES = [
    {
        "id": "major",
        "label": "Major Incident",
        "subject": "Major Incident Update: {title}",
        "body": (
            "Team,\n\n"
            "We are actively working a major incident impacting: {impact}.\n"
            "Summary: {summary}\n"
            "Severity: {severity}\n\n"
            "Next update: {next_update}\n"
            "- Incident Communications"
        ),
    },
    {
        "id": "incident",
        "label": "Incident",
        "subject": "Incident Update: {title}",
        "body": (
            "Hello Team,\n\n"
            "{summary}\n\n"
            "Impact: {impact}\n"
            "Status: {status}\n"
            "Next update: {next_update}\n"
            "- Incident Communications"
        ),
    },
    {
        "id": "service",
        "label": "Service Announcement",
        "subject": "Service Announcement: {title}",
        "body": (
            "Dear Customers,\n\n"
            "{summary}\n\n"
            "Effective: {effective_date}\n"
            "Additional details: {impact}\n"
            "- Service Communications"
        ),
    },
]


TEMPLATE_LOOKUP = {template["id"]: template for template in ANNOUNCEMENT_TEMPLATES}
