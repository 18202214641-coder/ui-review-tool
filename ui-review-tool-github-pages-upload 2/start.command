#!/bin/bash
cd "$(dirname "$0")" || exit 1

PORT=4173

(
  sleep 1
  open "http://127.0.0.1:${PORT}"
) &

exec ruby -run -e httpd . -p "${PORT}"
