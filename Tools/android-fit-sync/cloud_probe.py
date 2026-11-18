#!/usr/bin/env python3
"""Paused research: interactive UNA account download probe (standard library only).

Not bundled with UNA Activity. See UNA-CLOUD-RESEARCH.md before use.
Credentials stay in memory. Only listed authentication POSTs and data GETs are permitted.
Run in your own terminal; do not paste verification codes into chat.
"""

import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.unawatch.com"
LIMIT = 32 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, body=None, token=None):
    headers = {"Accept": "application/json", "User-Agent": "UNA-Activity-Research/1"}
    if token:
        if urllib.parse.urlsplit(url).netloc != "api.unawatch.com":
            raise ValueError("Account token may only be sent to UNA")
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        if url not in (
            BASE + "/auth/sign-in/phone-number",
            BASE + "/auth/sign-up/phone-number",
            BASE + "/auth/sign-in/phone-number/verify",
        ):
            raise ValueError("Only sign-in POSTs are permitted")
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=40) as response:
            result = response.read(LIMIT + 1)
    except urllib.error.HTTPError as error:
        # Never echo response bodies, which could contain account data or tokens.
        raise ValueError(f"Request failed: HTTP {error.code}; no automatic retry") from None
    except urllib.error.URLError:
        raise ValueError("Network/TLS request failed; no automatic retry") from None
    if len(result) > LIMIT:
        raise ValueError("Response exceeds 32 MB")
    return result


def api(path, body=None, token=None):
    return json.loads(request(BASE + path, body, token))


def crc16(data):
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    return crc


def validate_fit(data):
    if len(data) < 14 or data[0] not in (12, 14) or data[8:12] != b".FIT":
        raise ValueError("Download is not a supported FIT file")
    header = data[0]
    expected = header + int.from_bytes(data[4:8], "little") + 2
    if len(data) != expected:
        raise ValueError("FIT length mismatch")
    if header == 14 and data[12:14] != b"\0\0" and crc16(data[:14]) != 0:
        raise ValueError("FIT header CRC failed")
    if crc16(data) != 0:
        raise ValueError("FIT file CRC failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path.home() / "Downloads/UNA-cloud-test")
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise ValueError("Run interactively in your own terminal")
    print("Experimental UNA sign-in. A second login may affect your official app session.")
    phone = input("UNA account phone number (with +country code): ").strip()
    if not re.fullmatch(r"\+[1-9]\d{6,14}", phone):
        raise ValueError("Use international format, e.g. +countrycode followed by digits")
    print("The official app uses a shared sign-up/sign-in SMS endpoint.")
    print("An unrecognized number may start registration; this probe will stop rather than complete it.")
    if input(f"Request a code for your existing UNA account at {phone}? [y/N]: ").strip().lower() != "y":
        print("Cancelled; no code requested.")
        return
    response = api("/auth/sign-up/phone-number", {"phoneNumber": phone})
    if not isinstance(response, dict):
        raise ValueError("Unexpected SMS response; stopping")
    sent = response.get("smsSent")
    registered = response.get("registrationCompleted")
    print("UNA response: smsSent =", sent if isinstance(sent, bool) else "unknown",
          "; registrationCompleted =", registered if isinstance(registered, bool) else "unknown")
    if registered is not True:
        raise ValueError("UNA did not confirm a completed account for this number; stopping before verification")
    if sent is not True:
        raise ValueError("UNA did not confirm sending an SMS; stopping")
    print("UNA reports that an SMS was sent. Delivery to your phone is still unconfirmed.")
    code = getpass.getpass("SMS verification code (hidden): ").strip()
    result = api("/auth/sign-in/phone-number/verify", {"phoneNumber": phone, "code": code})
    token = result.get("tokens", {}).get("access_token")
    del result, phone, code
    if not isinstance(token, str) or not token:
        raise ValueError("Unexpected sign-in response; no token saved")
    print("Sign-in succeeded. Reading account sync data…")
    result = api("/sync/pull?lastPulledAt=0", token=token)
    changes = result.get("changes", {})
    # Confirm the live schema before guessing an activity identifier.
    activities = changes.get("activities")
    if not isinstance(activities, dict):
        print("Sync succeeded; table names:", ", ".join(changes) if isinstance(changes, dict) else "(unexpected)")
        raise ValueError("Activity schema needs inspection before downloading")
    records = activities.get("created", []) + activities.get("updated", [])
    records = [r for r in records if isinstance(r, dict) and isinstance(r.get("id"), str)]
    print(f"Received {len(records)} activity records.")
    if not records:
        return
    print("First activity field names:", ", ".join(records[0]))
    choice = input(f"Download one sample? Enter record number 1–{len(records)}, or Enter to stop: ").strip()
    if not choice:
        return
    if not choice.isdigit() or not 1 <= int(choice) <= len(records):
        raise ValueError("Invalid record number")
    activity = records[int(choice) - 1]
    signed = api("/sync/" + urllib.parse.quote(activity["id"], safe="") + "/file", token=token)
    del token
    url = signed if isinstance(signed, str) else signed.get("url") if isinstance(signed, dict) else None
    if not isinstance(url, str):
        print("File-response field names:", ", ".join(signed) if isinstance(signed, dict) else type(signed).__name__)
        raise ValueError("Download response schema needs inspection")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("Expected an HTTPS signed download URL")
    # No UNA authorization header is sent to file storage.
    data = request(url)
    validate_fit(data)
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    filename = hashlib.sha256(data).hexdigest() + ".fit"
    target = args.output / filename
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(data)
    print(f"SUCCESS: downloaded {len(data)} bytes; FIT length and CRC checks passed.")
    print(f"Saved to {target}")
    print("Account tokens were not saved. Check that the official app is still signed in.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        # Avoid exception strings for filesystem/network errors containing URLs.
        print(str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError)
              else f"Stopped: {type(error).__name__}; no credentials logged.", file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print("\nStopped.")
        sys.exit(1)
