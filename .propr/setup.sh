#!/bin/sh
set -eu

need_build_tools=0
for tool in python3 make g++; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    need_build_tools=1
  fi
done

run_with_privileges() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo "$@"
  else
    return 1
  fi
}

if [ "$need_build_tools" -eq 1 ] && command -v apk >/dev/null 2>&1; then
  if ! run_with_privileges apk add --no-cache python3 make g++; then
    true
  fi
elif [ "$need_build_tools" -eq 1 ] && command -v apt-get >/dev/null 2>&1; then
  if run_with_privileges apt-get update; then
    if ! run_with_privileges apt-get install -y --no-install-recommends python3 make g++; then
      true
    fi
  fi
fi

missing_tools=0
for tool in python3 make g++; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required to build node-pty." >&2
    missing_tools=1
  fi
done

if [ "$missing_tools" -eq 1 ]; then
  echo "Install python3, make, and g++, or run setup with package-manager privileges." >&2
  exit 1
fi
