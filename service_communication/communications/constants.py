ANNOUNCEMENT_TEMPLATES = [
    {
        "id": "major",
        "label": "Major Incident",
        "subject": "Major Incident Update: {incident_title}",
        "body": (
            "Incident {incident_number} remains in progress.\n\n"
            "Problem Statement:\n"
            "{problem}\n\n"
            "Workaround / Mitigation:\n"
            "{workaround}\n\n"
            "Next Update:\n"
            "{next_update}\n\n"
            "Point of Contact: {poc_name} ({poc_email})\n"
            "{custom_notes}"
        ),
        "html_body": """
            <div style="font-family:Arial,sans-serif;font-size:14px;color:#1F1F1F;line-height:1.5;">
                <p style="margin:0 0 12px;">Team,</p>
                <p style="margin:0 0 12px;">
                    <strong>Incident:</strong> {incident_title} ({incident_number})
                </p>
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;font-weight:600;width:180px;">Problem Statement</td>
                    <td style="padding:8px 0;">{problem}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-weight:600;">Workaround / Mitigation</td>
                    <td style="padding:8px 0;">{workaround}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-weight:600;">Next Update</td>
                    <td style="padding:8px 0;">{next_update}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-weight:600;">Point of Contact</td>
                    <td style="padding:8px 0;">{poc_name} ({poc_email})</td>
                  </tr>
                </table>
                {custom_notes_html}
                <p style="margin:16px 0 0;">Thank you,<br/>Incident Communications</p>
            </div>
        """,
    },
    {
        "id": "incident",
        "label": "Incident",
        "subject": "Incident Update: {incident_title}",
        "body": (
            "Hello Team,\n\n"
            "Incident {incident_number} status: {status}\n\n"
            "Problem Statement:\n"
            "{problem}\n\n"
            "Workaround:\n"
            "{workaround}\n\n"
            "Next update: {next_update}\n\n"
            "Point of Contact: {poc_name} ({poc_email})\n"
            "{custom_notes}"
        ),
        "html_body": """
            <div style="font-family:Arial,sans-serif;font-size:14px;color:#1F1F1F;line-height:1.5;">
                <p style="margin:0 0 12px;">Hello Team,</p>
                <p style="margin:0 0 12px;">
                    <strong>Incident:</strong> {incident_title} ({incident_number})<br/>
                    <strong>Status:</strong> {status}
                </p>
                <div style="margin-bottom:12px;">
                    <p style="font-weight:600;margin:0 0 4px;">Problem Statement</p>
                    <p style="margin:0;">{problem}</p>
                </div>
                <div style="margin-bottom:12px;">
                    <p style="font-weight:600;margin:0 0 4px;">Workaround / Mitigation</p>
                    <p style="margin:0;">{workaround}</p>
                </div>
                <p style="margin:0 0 12px;"><strong>Next Update:</strong> {next_update}</p>
                <p style="margin:0 0 12px;"><strong>Point of Contact:</strong> {poc_name} ({poc_email})</p>
                {custom_notes_html}
                <p style="margin:16px 0 0;">Thanks,<br/>Incident Communications</p>
            </div>
        """,
    },
    {
        "id": "service",
        "label": "Service Announcement",
        "subject": "Service Announcement: {incident_title}",
        "body": (
            "Dear Customers,\n\n"
            "{problem}\n\n"
            "Effective: {next_update}\n"
            "Impact: {impact}\n"
            "Point of Contact: {poc_name} ({poc_email})\n"
            "{custom_notes}"
        ),
        "html_body": """
            <div style="font-family:Arial,sans-serif;font-size:14px;color:#1F1F1F;line-height:1.5;">
                <p style="margin:0 0 12px;">Dear Customers,</p>
                <p style="margin:0 0 12px;">{problem}</p>
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;font-weight:600;width:180px;">Effective</td>
                    <td style="padding:8px 0;">{next_update}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-weight:600;">Impact</td>
                    <td style="padding:8px 0;">{impact}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-weight:600;">Point of Contact</td>
                    <td style="padding:8px 0;">{poc_name} ({poc_email})</td>
                  </tr>
                </table>
                {custom_notes_html}
                <p style="margin:16px 0 0;">Regards,<br/>Service Communications</p>
            </div>
        """,
    },
]


TEMPLATE_LOOKUP = {template["id"]: template for template in ANNOUNCEMENT_TEMPLATES}
