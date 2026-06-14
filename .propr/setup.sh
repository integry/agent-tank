#!/bin/sh
set -eu

if command -v apk >/dev/null 2>&1; then
  if ! command -v python3 >/dev/null 2>&1 || \
    ! command -v make >/dev/null 2>&1 || \
    ! command -v g++ >/dev/null 2>&1; then
    if [ "$(id -u)" = "0" ]; then
      apk add --no-cache python3 make g++
    elif sudo -n true >/dev/null 2>&1; then
      sudo apk add --no-cache python3 make g++
    else
      echo "Skipping apk build dependencies; sudo is unavailable in this container." >&2
      export npm_config_ignore_scripts=true
    fi
  fi
fi

npm ci
