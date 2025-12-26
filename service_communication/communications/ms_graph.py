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


def _build_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    token = _get_app_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def _mask_client_id(client_id: Optional[str]) -> str:
    if not client_id:
        return "unknown"
    if len(client_id) <= 8:
        return "***"
    return f"{client_id[:4]}...{client_id[-4:]}"


def _log_graph_request(strategy: str, params: Dict[str, str], response: requests.Response) -> None:
    logger.info(
        "Graph group search (%s) tenant=%s client=%s status=%s url=%s params=%s",
        strategy,
        settings.AZURE_TENANT_ID,
        _mask_client_id(settings.AZURE_CLIENT_ID),
        response.status_code,
        response.request.url,
        params,
    )


def fetch_directory_lists(search: Optional[str] = None, limit: int = 20) -> List[Dict]:
    """Fetch Microsoft 365 distribution groups."""
    if not _has_graph_config():
        raise ActiveDirectoryConfigurationError("Azure AD credentials are not configured.")
    params = {
        "$top": limit,
        "$select": "id,displayName,mail,description,mailNickname,mailEnabled,securityEnabled",
    }
    if not search:
        params["$filter"] = "mailEnabled eq true and securityEnabled eq false"
        response = requests.get(
            f"{GRAPH_BASE_URL}/groups",
            headers=_build_headers(),
            params=params,
            timeout=15,
        )
        _log_graph_request("filter", params, response)
        response.raise_for_status()
        payload = response.json()
        return payload.get("value", [])

    sanitized = search.replace("'", "''")
    search_query = f"\"displayName:{sanitized}\" OR \"mail:{sanitized}\""
    search_params = {
        **params,
        "$search": search_query,
        "$count": "true",
    }
    try:
        response = requests.get(
            f"{GRAPH_BASE_URL}/groups",
            headers=_build_headers({"ConsistencyLevel": "eventual"}),
            params=search_params,
            timeout=15,
        )
        _log_graph_request("search", search_params, response)
        response.raise_for_status()
        payload = response.json()
        values = payload.get("value", [])
        return [
            group
            for group in values
            if group.get("mailEnabled") is True and group.get("securityEnabled") is False
        ]
    except requests.exceptions.HTTPError as exc:
        response = exc.response
        status_code = response.status_code if response is not None else None
        if status_code in (400, 404):
            fallback_params = {
                **params,
                "$filter": (
                    "mailEnabled eq true and securityEnabled eq false and "
                    f"(startswith(displayName,'{sanitized}') "
                    f"or startswith(mail,'{sanitized}') "
                    f"or startswith(mailNickname,'{sanitized}'))"
                ),
            }
            response = requests.get(
                f"{GRAPH_BASE_URL}/groups",
                headers=_build_headers(),
                params=fallback_params,
                timeout=15,
            )
            _log_graph_request("filter-fallback", fallback_params, response)
            response.raise_for_status()
            payload = response.json()
            return payload.get("value", [])
        raise


def fetch_directory_list_by_id(object_id: str) -> Optional[Dict]:
    if not _has_graph_config():
        return None
    params = {"$select": "id,displayName,mail,description,mailNickname"}
    response = requests.get(
        f"{GRAPH_BASE_URL}/groups/{object_id}",
        headers=_build_headers(),
        params=params,
        timeout=15,
    )
    _log_graph_request("by-id", params, response)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def fetch_directory_list_by_email(email: str) -> Optional[Dict]:
    if not _has_graph_config() or not email:
        return None
    sanitized = email.replace("'", "''")
    params = {
        "$top": 1,
        "$select": "id,displayName,mail,description,mailNickname",
        "$filter": (
            f"mailEnabled eq true and securityEnabled eq false and "
            f"mail eq '{sanitized}'"
        ),
    }
    response = requests.get(
        f"{GRAPH_BASE_URL}/groups",
        headers=_build_headers(),
        params=params,
        timeout=15,
    )
    _log_graph_request("by-email", params, response)
    response.raise_for_status()
    payload = response.json()
    values = payload.get("value") or []
    return values[0] if values else None
