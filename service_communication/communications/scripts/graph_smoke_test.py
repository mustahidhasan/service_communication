#!/usr/bin/env python3
import argparse
import os
import sys
from pathlib import Path

import django


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke test Microsoft Graph distribution list search."
    )
    parser.add_argument(
        "--query",
        help="Display name or email prefix to search for.",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Fetch the first page of distribution lists without filtering.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        help="Max number of results to fetch.",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(project_root))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "service_communication.settings")
    django.setup()

    from communications.ms_graph import fetch_directory_lists  # noqa: E402

    if not args.all and not args.query:
        parser.error("Either --query or --all is required.")

    search = None if args.all else args.query
    results = fetch_directory_lists(search=search, limit=args.limit)
    if not results:
        if args.all:
            print("No distribution lists found.")
        else:
            print("No distribution lists found for query:", args.query)
        return 1

    label = "all" if args.all else f"'{args.query}'"
    print(f"Found {len(results)} distribution list(s) for {label}:")
    for entry in results:
        name = entry.get("displayName") or entry.get("mailNickname") or entry.get("id")
        mail = entry.get("mail") or "no-mail"
        print(f"- {name} ({mail})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
