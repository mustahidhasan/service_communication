import logging
import time
from typing import Dict, List, Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

_TOKEN_CACHE = {"access_token": None, "expires_at": 0}

GRAPH_SCOPE = "https://graph.microsoft.com/.default"
GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"


class ActiveDirectoryConfigurationError(Exception):
    """Raised when the Microsoft Graph configuration is incomplete."""


def _has_graph_config() -> bool:
    required = [
        settings.AZURE_TENANT_ID,
        settings.AZURE_CLIENT_ID,
        settings.AZURE_CLIENT_SECRET,
    ]
    return all(required)


def _get_app_token() -> str:
    if not _has_graph_config():
        raise ActiveDirectoryConfigurationError("Azure AD credentials are not configured.")
    now = time.time()
    if _TOKEN_CACHE["access_token"] and _TOKEN_CACHE["expires_at"] > now + 60:
        return _TOKEN_CACHE["access_token"]
    payload = {
        "client_id": settings.AZURE_CLIENT_ID,
        "client_secret": settings.AZURE_CLIENT_SECRET,
        "scope": GRAPH_SCOPE,
        "grant_type": "client_credentials",
    }
    token_url = f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/oauth2/v2.0/token"
    response = requests.post(token_url, data=payload, timeout=15)
    response.raise_for_status()
    data = response.json()
    access_token = data.get("access_token")
    if not access_token:
        raise ActiveDirectoryConfigurationError("Unable to retrieve Microsoft Graph token.")
    expires_in = data.get("expires_in", 3600)
    _TOKEN_CACHE["access_token"] = access_token
    _TOKEN_CACHE["expires_at"] = now + int(expires_in)
    return access_token


def _build_headers() -> Dict[str, str]:
    token = _get_app_token()
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def fetch_directory_lists(search: Optional[str] = None, limit: int = 30) -> List[Dict]:
    """Fetch Microsoft 365 distribution groups."""
    if not _has_graph_config():
        return []
    params = {
        "$top": limit,
        "$select": "id,displayName,mail,description,mailNickname",
        "$filter": "mailEnabled eq true and securityEnabled eq false",
    }
    if search:
        sanitized = search.replace("'", "''")
        params["$filter"] += f" and startsWith(displayName,'{sanitized}')"
    response = requests.get(
        f"{GRAPH_BASE_URL}/groups",
        headers=_build_headers(),
        params=params,
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    return payload.get("value", [])


def fetch_directory_list_by_id(object_id: str) -> Optional[Dict]:
    if not _has_graph_config():
        return None
    response = requests.get(
        f"{GRAPH_BASE_URL}/groups/{object_id}",
        headers=_build_headers(),
        params={"$select": "id,displayName,mail,description,mailNickname"},
        timeout=15,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()
