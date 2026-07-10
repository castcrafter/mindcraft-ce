#!/bin/sh
set -e

if command -v xvfb-run >/dev/null 2>&1; then
    exec xvfb-run --auto-servernum --server-args='-screen 0 1024x768x24' node main.js
fi

echo "xvfb-run is not installed; starting without a virtual display. Keep allow_vision and render_bot_view disabled."
exec node main.js
