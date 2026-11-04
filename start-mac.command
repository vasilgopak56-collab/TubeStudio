#!/bin/bash
# TubeStudio — запуск на macOS/Linux (двойной клик или ./start-mac.command)
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Node.js не найден. Установите LTS с https://nodejs.org"; open https://nodejs.org 2>/dev/null; read -p "Enter для выхода"; exit 1; fi
[ -d node_modules ] || { echo "[1/3] Устанавливаю зависимости…"; npm install || exit 1; }
[ -f .env ] || cp .env.example .env
[ -f apps/web/dist/index.html ] && [ -f apps/server/dist/index.js ] || { echo "[2/3] Собираю…"; npm run build || exit 1; }
echo "[3/3] TubeStudio: http://127.0.0.1:8787 (остановить — Ctrl+C)"
( sleep 4; open http://127.0.0.1:8787 2>/dev/null || xdg-open http://127.0.0.1:8787 ) &
npm start
