#!/usr/bin/env python3
"""Inventory and build the watch apps without changing the SDK checkout."""

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
APPS = {
    "BatteryTracker": "BatteryTracker/Software/Apps/BatteryTracker-CMake",
    "HRClock": "HRClock/Software/Apps/HRClock-CMake",
    "HikeMap": "HikeMap/Software/Apps/HikeMap-CMake",
    "RunMap": "RunMap/Software/Apps/RunMap-CMake",
    "MapManager": "MapManager/Software/Apps/MapManager-CMake",
}


def cmake_value(source, name):
    match = re.search(rf'^\s*set\({name}\s+"([^"]+)"\)', source, re.MULTILINE)
    return match.group(1) if match else "—"


def sdk_path():
    value = os.environ.get("UNA_SDK")
    if value:
        return Path(value).expanduser().resolve()
    for candidate in (ROOT.parent / "una-sdk", ROOT / "una-sdk"):
        if (candidate / "cmake/una-app.cmake").is_file():
            return candidate.resolve()
    return None


def doctor():
    sdk = sdk_path()
    if not sdk or not (sdk / "cmake/una-app.cmake").is_file():
        print("Set UNA_SDK to a UNA SDK checkout containing cmake/una-app.cmake", file=sys.stderr)
        return False
    print(f"SDK: {sdk}")
    revision = subprocess.run(
        ["git", "-C", str(sdk), "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True, check=False,
    )
    if revision.returncode == 0:
        print(f"SDK revision: {revision.stdout.strip()} (record this with each release)")
        changes = subprocess.run(
            ["git", "-C", str(sdk), "status", "--porcelain"],
            capture_output=True, text=True, check=False,
        )
        if changes.stdout.strip():
            print("Warning: SDK checkout has local changes")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="show app metadata from CMake")
    commands.add_parser("doctor", help="show the selected external SDK revision")
    build = commands.add_parser("build", help="configure and build one app")
    build.add_argument("app", choices=APPS)
    build.add_argument("--sdk-revision", required=True, help="full SDK Git commit required by this app")
    build.add_argument("--version", help="set BUILD_VERSION for this build")
    args = parser.parse_args()

    if args.command == "list":
        for app, directory in APPS.items():
            source = (ROOT / directory / "CMakeLists.txt").read_text()
            print(f"{app}: {cmake_value(source, 'APP_USER_NAME')} | "
                  f"{cmake_value(source, 'APP_TYPE')} | APP_ID {cmake_value(source, 'APP_ID')}")
        return 0
    if not doctor():
        return 1
    if args.command == "doctor":
        return 0
    sdk = sdk_path()
    revision = subprocess.run(
        ["git", "-C", str(sdk), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=False,
    )
    if revision.returncode != 0 or revision.stdout.strip() != args.sdk_revision:
        print(f"SDK revision mismatch: expected {args.sdk_revision}, "
              f"found {revision.stdout.strip() or 'unknown'} at {sdk}. "
              "Select the pinned SDK checkout with UNA_SDK; this tool will not change it.",
              file=sys.stderr)
        return 1
    changes = subprocess.run(
        ["git", "-C", str(sdk), "status", "--porcelain", "--untracked-files=no"],
        capture_output=True, text=True, check=False,
    )
    if changes.returncode != 0 or changes.stdout.strip():
        print(f"SDK checkout at {sdk} has tracked local changes; "
              "use a clean checkout of the pinned commit for reproducible builds.",
              file=sys.stderr)
        return 1
    if args.app in ("HRClock", "HikeMap", "RunMap", "MapManager"):
        generated = ROOT / args.app / "Software/Apps/TouchGFX-GUI/generated"
        required = [
            generated / "fonts/include/fonts/ApplicationFontProvider.hpp",
            generated / "gui_generated/include/gui_generated/common/FrontendApplicationBase.hpp",
            generated / "texts/include/texts/TextKeysAndLanguages.hpp",
        ]
        if any(not path.is_file() for path in required):
            print(f"{args.app} requires TouchGFX-generated GUI sources under {generated}. "
                  "Generate them with the matching TouchGFX Designer before building.",
                  file=sys.stderr)
            return 1
    source = ROOT / APPS[args.app]
    # Some existing build/ caches were configured in other checkout locations.
    # A dedicated cache avoids inheriting their absolute paths.
    destination = source / "build" / "pinned"
    command = ["cmake", "-S", str(source), "-B", str(destination)]
    command.append(f"-DUNA_PYTHON_EXECUTABLE={sys.executable}")
    if args.version:
        if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
            parser.error("--version must be MAJOR.MINOR.PATCH")
        command.append(f"-DBUILD_VERSION={args.version}")
    environment = {**os.environ, "UNA_SDK": str(sdk)}
    subprocess.run(command, check=True, env=environment)
    subprocess.run(["cmake", "--build", str(destination)], check=True, env=environment)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
