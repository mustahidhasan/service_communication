"""Lightweight helper for retrieving and caching email templates."""
from typing import Dict, Optional

from django.utils import timezone

from .constants import TEMPLATE_LOOKUP
from .models import EmailTemplate

_TEMPLATE_CACHE: Dict[str, Dict] = {}


def _serialize_template(template) -> Dict:
    return {
        "key": template.key,
        "name": template.name,
        "description": template.description,
        "subject": template.subject,
        "body_text": template.body_text,
        "body_html": template.body_html,
        "version": template.version,
        "updated_at": template.updated_at or timezone.now(),
    }


def get_template_data(key: str) -> Optional[Dict]:
    if not key:
        return None
    cached = _TEMPLATE_CACHE.get(key)
    if cached:
        return cached
    template = (
        EmailTemplate.objects.filter(key=key, is_active=True)
        .order_by("-version", "-updated_at")
        .first()
    )
    if template:
        data = _serialize_template(template)
        _TEMPLATE_CACHE[key] = data
        return data
    fallback = TEMPLATE_LOOKUP.get(key)
    if fallback:
        data = {
            "key": fallback.get("id"),
            "name": fallback.get("label"),
            "description": fallback.get("description", ""),
            "subject": fallback.get("subject"),
            "body_text": fallback.get("body"),
            "body_html": fallback.get("html_body"),
            "version": fallback.get("version", 1),
            "updated_at": timezone.now(),
        }
        _TEMPLATE_CACHE[key] = data
        return data
    return None


def invalidate_template_cache(key: Optional[str] = None):
    if key:
        _TEMPLATE_CACHE.pop(key, None)
    else:
        _TEMPLATE_CACHE.clear()
