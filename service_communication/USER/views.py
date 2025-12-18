import urllib.parse
import requests
from django.conf import settings
from django.contrib.auth import login, logout, get_user_model
from django.http import JsonResponse
from django.utils.timezone import now, timedelta
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect
from django.views.decorators.http import require_GET
import logging
from USER.models import UserActivity, UserProfile, UserRole, get_user_role

User = get_user_model()
logger = logging.getLogger(__name__)

RECENT_LOGIN_DUPLICATE_WINDOW = timedelta(seconds=5)
SESSION_ACTIVITY_KEY = "active_login_activity_id"


@require_GET
def app_metadata(request):
    contact_email = (
        settings.DEFAULT_FROM_EMAIL
        or settings.EMAIL_HOST_USER
        or settings.EMAIL_HOST
        or "no-reply@example.com"
    )
    return JsonResponse(
        {
            "contact_email": contact_email,
        }
    )


def login_view(request):
    return JsonResponse({"message": "Render login page here (SSO button logic handled in frontend)"})


def azure_login(request):
    params = {
        'client_id': settings.AZURE_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': settings.AZURE_REDIRECT_URI,
        'response_mode': 'query',
        'scope': settings.AZURE_SCOPES,
        'state': 'some_random_state',
    }
    login_url = f"{settings.AZURE_AUTHORIZE_ENDPOINT}?{urllib.parse.urlencode(params)}"
    return JsonResponse({"login_url": login_url})


def azure_callback(request):
    code = request.GET.get('code')
    next_url = request.GET.get('next', '/')

    token_data = {
        'client_id': settings.AZURE_CLIENT_ID,
        'scope': settings.AZURE_SCOPES,
        'code': code,
        'redirect_uri': settings.AZURE_REDIRECT_URI,
        'grant_type': 'authorization_code',
        'client_secret': settings.AZURE_CLIENT_SECRET,
    }

    try:
        token_response = requests.post(settings.AZURE_TOKEN_ENDPOINT, data=token_data)
        tokens = token_response.json()

        if 'access_token' not in tokens:
            return JsonResponse({'error': 'Token exchange failed', 'details': tokens}, status=400)

        headers = {'Authorization': f"Bearer {tokens['access_token']}"}
        graph_response = requests.get("https://graph.microsoft.com/v1.0/me", headers=headers)
        user_info = graph_response.json()

        email = user_info.get('mail') or user_info.get('userPrincipalName')
        name = user_info.get('displayName') or email

        if not email:
            return JsonResponse({'error': 'Could not retrieve user email'}, status=400)

        user, created = User.objects.get_or_create(
            email=email, defaults={'username': email, 'first_name': name}
        )

        profile, _ = UserProfile.objects.get_or_create(user=user)
        if created:
            profile.set_role(UserRole.USER, manual=False)

        now_ts = now()
        duplicate_session = None
        open_sessions = UserActivity.objects.filter(
            user=user,
            activity_type='login',
            session_status=True,
        ).order_by('-timestamp')
        for session in open_sessions:
            if (
                duplicate_session is None
                and (now_ts - session.timestamp) <= RECENT_LOGIN_DUPLICATE_WINDOW
            ):
                duplicate_session = session
                continue
            session.duration = (now_ts - session.timestamp).total_seconds()
            session.session_status = False
            session.save(update_fields=['duration', 'session_status'])

        login(request, user)

        if duplicate_session is not None:
            request.session[SESSION_ACTIVITY_KEY] = duplicate_session.id
            safe_redirect = next_url if next_url.startswith('/') else '/'
            return redirect(f"{settings.FRONTEND_URL}{safe_redirect}")

        new_activity = UserActivity.objects.create(
            user=user,
            activity_type='login',
            session_status=True,
        )
        request.session[SESSION_ACTIVITY_KEY] = new_activity.id

        safe_redirect = next_url if next_url.startswith('/') else '/'
        return redirect(f"{settings.FRONTEND_URL}{safe_redirect}")

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def azure_logout(request):
    if request.method != "POST":
        return JsonResponse({"success": False, "message": "Invalid method"}, status=405)

    user = request.user

    try:
        activity_id = request.session.pop(SESSION_ACTIVITY_KEY, None)
        if activity_id:
            last_login_activity = UserActivity.objects.get(
                id=activity_id,
                user=user,
                activity_type='login',
                session_status=True,
            )
        else:
            last_login_activity = UserActivity.objects.filter(
                user=user,
                activity_type='login',
                session_status=True
            ).latest('timestamp')

        duration_seconds = (now() - last_login_activity.timestamp).total_seconds()
        last_login_activity.session_status = False
        last_login_activity.duration = duration_seconds
        last_login_activity.save()

        UserActivity.objects.create(
            user=user,
            activity_type='logout',
            duration=0,
            session_status=False,
        )
    except UserActivity.DoesNotExist:
        logger.warning("Logout requested but no matching login activity for user %s", user)

    logout(request)

    azure_logout_url = (
        f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/oauth2/v2.0/logout"
        f"?client_id={urllib.parse.quote(settings.AZURE_CLIENT_ID)}"
        f"&post_logout_redirect_uri={urllib.parse.quote(settings.POST_LOGOUT_REDIRECT_URI, safe='')}"
    )
    return JsonResponse({
        "success": True,
        "logout_url": azure_logout_url,
        "redirect_url": settings.FRONTEND_URL,
    })


@login_required
def active_users_dashboard(request):
    recent_threshold = now() - timedelta(minutes=15)
    active_sessions = UserActivity.objects.filter(
        timestamp__gte=recent_threshold,
        activity_type='login',
        session_status=True,
    )
    active_users = User.objects.filter(
        id__in=active_sessions.values_list('user_id', flat=True)
    ).distinct()

    user_activities = UserActivity.objects.select_related('user').order_by('-timestamp')[:100]

    return JsonResponse({
        "active_user_count": active_users.count(),
        "active_users": [
            {
                "id": user.id,
                "email": user.email,
                "name": user.first_name,
                "role": get_user_role(user),
            }
            for user in active_users
        ],
        "user_activities": [
            {
                "user_id": activity.user.id,
                "email": activity.user.email,
                "activity_type": activity.activity_type,
                "timestamp": activity.timestamp.isoformat(),
                "duration": activity.formatted_duration,
                "session_status": "Active" if activity.session_status else "Closed"
            } for activity in user_activities
        ]
    })
