from django.urls import path
from . import views

urlpatterns = [
    path('', views.login_view, name='login'),
    path('app-meta/', views.app_metadata, name='app_metadata'),
    path('azure-login/', views.azure_login, name='azure_login'),
    path('oauth2/callback/', views.azure_callback, name='azure_callback'),
    path('logout/', views.azure_logout, name='azure_logout'),  # Add this line
    path('active-users/', views.active_users_dashboard, name='active_users_dashboard'),

]
