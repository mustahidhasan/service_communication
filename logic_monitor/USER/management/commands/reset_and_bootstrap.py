import os

from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import BaseCommand, call_command
from django.core.management.base import CommandError
from django.db import connection
from django.db.migrations.loader import MigrationLoader

from USER.models import UserRole


class Command(BaseCommand):
    help = (
        "Unapply every migration, rebuild the database from scratch, and ensure the default "
        "admin user exists."
    )

    def handle(self, *args, **options):
        if self._is_sqlite():
            self._reset_sqlite_database()
        else:
            self._rollback_all_migrations()

        self.stdout.write(self.style.WARNING("Re-applying migrations..."))
        call_command("migrate", interactive=False, verbosity=0)

        self.stdout.write(self.style.WARNING("Ensuring default admin user exists..."))
        self._ensure_default_admin()
        self.stdout.write(self.style.SUCCESS("Database reset complete."))

    def _ensure_default_admin(self):
        User = get_user_model()
        username = "admin"
        email = "admin@example.com"
        password = "admin"

        user, created = User.objects.get_or_create(
            username=username,
            defaults={"email": email},
        )
        user.is_staff = True
        user.is_superuser = True
        # Always set the password so credentials remain predictable after rebuilds.
        user.set_password(password)
        user.save(update_fields=["is_staff", "is_superuser", "password", "email"])

        # Guarantee a profile exists so role-based checks continue to behave.
        if hasattr(user, "profile"):
            user.profile.set_role(UserRole.SYSTEM_ADMIN, manual=True)
        else:
            profile_model = apps.get_model("USER", "UserProfile")
            profile_model.objects.update_or_create(
                user=user,
                defaults={"role": UserRole.SYSTEM_ADMIN, "assigned_manually": True},
            )

        message = "created" if created else "updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"Default admin user {message}: username='admin', password='admin'."
            )
        )

    def _is_sqlite(self):
        engine = settings.DATABASES["default"]["ENGINE"]
        return "sqlite3" in engine

    def _reset_sqlite_database(self):
        db_path = settings.DATABASES["default"]["NAME"]
        if db_path and os.path.exists(db_path):
            self.stdout.write(self.style.WARNING(f"Removing SQLite database at {db_path}"))
            connection.close()
            os.remove(db_path)
        else:
            self.stdout.write(self.style.WARNING("SQLite database file not found; skipping removal."))

    def _rollback_all_migrations(self):
        self.stdout.write(self.style.WARNING("Rolling back all migrations..."))
        loader = MigrationLoader(connection, ignore_no_migrations=True)
        for app_label in sorted(loader.migrated_apps):
            try:
                self.stdout.write(f"  • Resetting {app_label} ...")
                call_command("migrate", app_label, "zero", interactive=False, verbosity=0)
            except CommandError as exc:
                self.stderr.write(f"    Skipped {app_label}: {exc}")
