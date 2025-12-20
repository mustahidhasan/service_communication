from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView


class NetworkOpsStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "module": "network-operations",
                "status": "online",
                "user": request.user.email or request.user.username,
            }
        )
