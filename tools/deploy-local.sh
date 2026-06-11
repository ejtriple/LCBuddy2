#!/bin/sh
# Build the stock client + bot client and deploy both into a local Engine's
# public/ (see docs/DEV.md). Players: /rs2.cgi untouched; bot: /bot.html.
set -e

ENGINE="${ENGINE_DIR:-$HOME/code/lostcity-dev/engine}"

if [ ! -d "$ENGINE/public" ]; then
    echo "engine public/ not found at $ENGINE (set ENGINE_DIR)" >&2
    exit 1
fi

bun run build
bun run build:bot

cp out/client.js out/client.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/tinymidipcm.wasm "$ENGINE/public/client/"

mkdir -p "$ENGINE/public/bot"
cp out/botclient.js out/botclient.js.map out/ondemandworker.js out/ondemandworker.js.map \
   out/tinymidipcm.wasm "$ENGINE/public/bot/"
cp public-bot/bot.html "$ENGINE/public/bot.html"

# soundfont lives in the engine repo, not ours; the bot bundle resolves it
# relative to itself
if [ -f "$ENGINE/public/client/SCC1_Florestan.sf2" ]; then
    cp "$ENGINE/public/client/SCC1_Florestan.sf2" "$ENGINE/public/bot/"
fi

echo "deployed: $ENGINE/public/bot.html (+ /bot, /client refreshed)"
