# Аудит зависимостей TubeStudio v0.12.46-preview.1

## Результат

В изолированной копии исходников устранены все восемь предупреждений, воспроизведённых npm audit из lockfile v0.12.45: 5 moderate и 3 high. Повторный аудит нового lockfile: 0 известных уязвимостей. Проверка относится к базе npm на момент подготовки сборки; это не гарантия отсутствия всех дефектов и не полный аудит безопасности приложения.

Не использовались npm audit fix --force, overrides или подавление предупреждений. React 18 и существующие пользовательские форматы данных сохранены.

## Что было затронуто

| Пакет | Было → стало | Где используется / оценка доступности |
| --- | --- | --- |
| Vite | 5.4.21 → 7.3.7 | Сборка и dev-server. При обычном запуске server/dist/index.js Vite dev-server не работает. Некоторые advisories особенно касаются Windows/launch-editor. |
| esbuild из Vite | 0.21.5 → общий 0.28.2 | Транзитивный инструмент сборки. Уязвимость dev-server esbuild не означает автоматически уязвимость производственного API TubeStudio. |
| react-router-dom | 6.30.6 → 7.18.5 | Runtime маршрутизация интерфейса. Предупреждение наследовалось от react-router. |
| react-router | 6.30.6 → 7.18.5 | Исправлены известные advisories маршрутизации; SSR/deserialization-путь не используется текущим BrowserRouter-приложением, но библиотека всё равно обновлена. |
| Zod | 3.25.76 → 4.6.7 | Runtime-валидация сервера и MCP. Обновление потребовало адаптации кода и регрессионных тестов, а не только смены номера пакета. |
| body-parser | 2.3.0 → 2.4.0 | SDK MCP → Express → body-parser. Текущий MCP подключает StdioServerTransport, а не HTTP Express transport; установленный пакет не доказывает доступность уязвимого middleware. |
| fast-uri | 3.1.8 → 3.1.9 | SDK MCP → AJV → fast-uri. Совместимое транзитивное обновление. |
| postcss-selector-parser | 6.1.4 → 6.1.5 | Tailwind/PostCSS, обработка CSS при разработке/сборке. Совместимое транзитивное обновление. |

Восемь предупреждений npm — не восемь независимых достижимых атак: например, react-router-dom учитывался из-за react-router. Оценка путей выше — по исходному коду, не результат penetration test.

Также обновлён @vitejs/plugin-react 4.7.0 → 5.2.0 для совместимости с Vite 7. Переходить на Vite 8 не понадобилось. SDK MCP остаётся 1.32.1; его заявленный диапазон поддерживает Zod 4.

## Совместимость Zod

- Типы ZodType адаптированы к API 4.x без отключения строгой проверки TypeScript.
- z.record получает явную схему строкового ключа.
- Для вложенных значений по умолчанию используется prefault({}), чтобы объект действительно проходил разбор и заполнялся, как раньше.
- При PATCH календаря пропущенные поля не получают defaults создания. Смена только notes/title не сбрасывает status/format/remindDays.
- Пропущенные выборы обложки и hook_strikes сохраняют прежнюю семантику необязательных полей.
- Семь новых тестов покрывают эти случаи и отказ слишком длинного массива до element transforms.

## Проверки

Среда: Linux, Node.js 24.22.1, npm 11.19.1. Установка выполнялась с --ignore-scripts. Чистый npm ci --ignore-scripts отдельно воспроизвёл установку из нового lockfile. Сборка прошла без общего разрешения install scripts.

- TypeScript: server / web / mcp — PASS.
- Production build: web / server / mcp — PASS.
- Модульные тесты: 683 PASS, 0 FAIL, 0 skipped.
- Синтетический перенос резервной копии: 7 PASS, 0 FAIL; 42 импортированные записи, 28 разрешённых разделов данных, два независимых серверных процесса и повторное чтение после перезапуска. Это маленький тестовый архив, не нагрузочная проверка и не гарантия транзакционности.
- Проверка Windows-файлов и синтаксиса JS на Linux — PASS. SHA-256 stop-helper остался 27bfafd0540a5c5d5e29c142b65e56a68e55d415db9eca3c6b85f91cda5bb0cb.
- Core E2E на локальном Chromium: 301 PASS, 0 FAIL, 0 skipped. extension.test.mjs исключён. Проверены в том числе версия UI/сервера, MCP stdio, Reach, прибыль, ZIP UI, мобильные экраны и основные инструменты на изолированных фикстурах.

Нативная Windows-приёмка v0.12.46 ещё не проводилась. Прежний пользовательский Windows-отчёт stop-test 1.0.1 относится к прежнему проверенному этапу, а не к новой сборке всех зависимостей.

Живые AI/YouTube аккаунты не использовались. Приватный пользовательский ZIP не загружался и не включён в исходники. Расширение Chrome не изменялось и исключено из core E2E. Шкала CTR по реальному непустому CSV пока не подтверждена.

## Источники предупреждений

Полные исходный и итоговый JSON npm audit приложены в docs/checks/. Среди advisories:

- Zod: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- body-parser: https://github.com/advisories/GHSA-27r3-jxmh-p828
- esbuild: https://github.com/advisories/GHSA-67mh-4wv8-2f99
- react-router: https://github.com/advisories/GHSA-wrjc-x8rr-h8h6 и https://github.com/advisories/GHSA-337j-9hxr-rhxg
- fast-uri: https://github.com/advisories/GHSA-w74x-v6f9-j3xg и остальные в JSON
- postcss-selector-parser: https://github.com/advisories/GHSA-rj75-hqrm-r3gf
- Vite (включая high/Windows): https://github.com/advisories/GHSA-587h-7wmj-h5pm и остальные в JSON

## Следующий шаг

Проверить кандидат на Windows в отдельной папке и на 8788. Не заменять рабочую v0.12.45/8787 до успешной проверки. Инструкция: WINDOWS-CHECK-v0.12.46-RU.md.
