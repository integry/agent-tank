#!/bin/sh
set -eu

need_build_tools=0
for tool in python3 make g++; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    need_build_tools=1
  fi
done

if [ "$need_build_tools" -eq 1 ] && command -v apk >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    apk add --no-cache python3 make g++
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo apk add --no-cache python3 make g++
  else
    echo "python3, make, and g++ are required to build node-pty; install them or run setup with apk privileges." >&2
  fi
fi
