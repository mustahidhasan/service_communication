import base64
import hashlib
import hmac
import json
import time
import requests
from django.conf import settings


class LogicMonitorClient:
    def __init__(self):
        self.account = settings.LOGICMONITOR_ACCOUNT
        self.access_id = settings.LOGICMONITOR_ACCESS_ID
        self.access_key = settings.LOGICMONITOR_ACCESS_KEY
        self.api_base = settings.LOGICMONITOR_API_BASE.rstrip("/")
        if not self.api_base:
            self.api_base = f"https://{self.account}.logicmonitor.com/santaba/rest"

    def _signature(self, http_verb, resource_path, data, epoch):
        request_vars = f"{http_verb}{epoch}{resource_path}{data}"
        digest = hmac.new(
            self.access_key.encode("utf-8"), request_vars.encode("utf-8"), hashlib.sha256
        ).digest()
        return base64.b64encode(digest).decode("utf-8")

    def _headers(self, http_verb, resource_path, data):
        epoch = str(int(time.time() * 1000))
        signature = self._signature(http_verb, resource_path, data, epoch)
        auth = f"LMv1 {self.access_id}:{signature}:{epoch}"
        return {
            "Content-Type": "application/json",
            "Authorization": auth,
        }

    def _serialize_payload(self, payload):
        return json.dumps(payload or {}, separators=(",", ":"), sort_keys=True)

    def request(self, http_verb, resource_path, payload=None, params=None):
        data = self._serialize_payload(payload) if payload is not None else ""
        headers = self._headers(http_verb, resource_path, data)
        url = f"{self.api_base}{resource_path}"
        response = requests.request(
            http_verb,
            url,
            headers=headers,
            params=params,
            data=data if payload is not None else None,
            timeout=20,
        )
        return response

    def create_sdt(self, payload):
        return self.request("POST", "/sdt/sdts", payload)

    def end_sdt(self, sdt_id):
        return self.request("DELETE", f"/sdt/sdts/{sdt_id}")

    def get_sdt(self, sdt_id):
        return self.request("GET", f"/sdt/sdts/{sdt_id}")

    def list_devices_for_site(self, lm_site_code):
        query_variants = [
            {"filter": f"displayName~\"{lm_site_code}\"", "size": 1000},
            {"filter": f"name~\"{lm_site_code}\"", "size": 1000},
            {"size": 1000},
        ]
        for params in query_variants:
            response = self.request("GET", "/device/devices", params=params)
            if not response.ok:
                continue
            try:
                payload = response.json()
            except ValueError:
                continue
            items = payload.get("data", {}).get("items") or payload.get("items") or []
            if params.get("filter") and items:
                return items
            if not params.get("filter"):
                scoped = [
                    item
                    for item in items
                    if lm_site_code.lower() in str(item.get("displayName", "")).lower()
                    or lm_site_code.lower() in str(item.get("name", "")).lower()
                ]
                if scoped:
                    return scoped
        return []
