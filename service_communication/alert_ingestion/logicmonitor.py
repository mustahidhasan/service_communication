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

    def request(self, http_verb, resource_path, payload=None):
        data = json.dumps(payload or {})
        headers = self._headers(http_verb, resource_path, data)
        url = f"{self.api_base}{resource_path}"
        response = requests.request(http_verb, url, headers=headers, data=data, timeout=20)
        return response

    def create_event(self, payload):
        return self.request("POST", "/alert/events", payload)

    def clear_event(self, payload):
        return self.request("POST", "/alert/events/clear", payload)
