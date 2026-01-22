import logging
import requests
import time
from django.conf import settings

logger = logging.getLogger(__name__)


class GraphConfigurationError(Exception):
    pass


def _get_graph_credentials():
    tenant_id = settings.AZURE_TENANT_ID
    client_id = settings.AZURE_CLIENT_ID
    client_secret = settings.AZURE_CLIENT_SECRET
    if not tenant_id or not client_id or not client_secret:
        raise GraphConfigurationError("Azure AD credentials are not configured for Graph access.")
    return tenant_id, client_id, client_secret


def fetch_graph_token():
    tenant_id, client_id, client_secret = _get_graph_credentials()
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    payload = {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "client_credentials",
        "scope": settings.GRAPH_APP_SCOPE,
    }
    response = requests.post(token_url, data=payload, timeout=20)
    response.raise_for_status()
    return response.json().get("access_token")


def _request_with_retry(method, url, **kwargs):
    last_exc = None
    for delay in (0, 1, 2, 4):
        if delay:
            time.sleep(delay)
        try:
            response = requests.request(method, url, timeout=20, **kwargs)
            response.raise_for_status()
            return response
        except Exception as exc:  # pylint: disable=broad-except
            last_exc = exc
    if last_exc:
        raise last_exc
    raise RuntimeError("Graph request failed without exception")


def fetch_messages(user_id, since=None, top=25):
    token = fetch_graph_token()
    headers = {"Authorization": f"Bearer {token}"}
    params = {"$top": top}
    if since:
        params["$filter"] = f"receivedDateTime ge {since}"
    url = f"{settings.GRAPH_API_BASE}/users/{user_id}/messages"
    response = _request_with_retry("GET", url, headers=headers, params=params)
    return response.json().get("value", [])


def fetch_message(user_id, message_id):
    token = fetch_graph_token()
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{settings.GRAPH_API_BASE}/users/{user_id}/messages/{message_id}"
    response = _request_with_retry("GET", url, headers=headers)
    return response.json()
