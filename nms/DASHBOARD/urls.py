# dashboard/urls.py

from django.urls import path
from .views import ping_operation, snmp_results, send_email

urlpatterns = [
    
    path("", ping_operation, name="ping_operation"),
    path('send-email/', send_email, name='send_email'),
]
