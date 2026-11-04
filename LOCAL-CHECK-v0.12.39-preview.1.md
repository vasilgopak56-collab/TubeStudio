# Отдельная проверка рекламных пауз v0.12.39-preview.1

Не распаковывайте поверх рабочей установки. Не копируйте рабочую .env, данные, ключи/OAuth или приватные промпты. Проверьте в отдельной папке с Node.js/npm. Это исходники: dist и node_modules не включены. Не запускайте smoke/реальные генерации ради этой проверки.

## Сборка в PowerShell
```powershell
npm ci
npm run typecheck
npm run build
npm run test:unit
npm run check:windows
```
Последняя команда проверяет только файлы запуска, не доказывает работу приложения на Windows. Модульные тесты создают временные тестовые данные и не наследуют провайдерские ключи.

## Только синтетические данные
В корне новой распакованной папки:
```powershell
$env:DATA_DIR = Join-Path (Get-Location) "preview-test-data"
$env:ENV_FILE = Join-Path $env:DATA_DIR "absent.env"
$env:PROMPTS_DIR = Join-Path $env:DATA_DIR "prompts"
$env:HOST = "127.0.0.1"
$env:PORT = "8798"
New-Item -ItemType Directory -Force $env:DATA_DIR | Out-Null
Copy-Item -Recurse -Force apps/server/prompts $env:PROMPTS_DIR
# Только из текущего процесса PowerShell, не из системных настроек:
Get-ChildItem Env: | Where-Object { $_.Name -match 'KEY|TOKEN|SECRET|PASSWORD' } | ForEach-Object { Remove-Item ("Env:" + $_.Name) }
$id = [guid]::NewGuid().ToString()
$source = @{
 id=$id; name="Synthetic pauses"; revision=4; updatedAt="2026-01-15T12:00:00.000Z"; duration=600
 fragments=@(
  @{n=1;start=0;end=100;text="One"},
  @{n=2;start=102;end=200;text="Two"},
  @{n=3;start=204;end=400;text="Three"},
  @{n=4;start=403;end=600;text="Four"}
 )
 pauses=@(@{start=100;end=102},@{start=200;end=204},@{start=400;end=403})
}
$folder = Join-Path $env:DATA_DIR "audio-storyboards"
New-Item -ItemType Directory -Force $folder | Out-Null
[IO.File]::WriteAllText((Join-Path $folder ($id+".json")), ($source | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
node apps/server/dist/index.js
```
Запускайте Node **без --env-file=.env**. ENV_FILE указывает на несуществующий файл в тестовой папке; не создавайте там рабочую .env. Сервер занимает терминал; после проверки остановите Ctrl+C. Откройте http://127.0.0.1:8798/ad-breaks. Не выбирайте загрузку, распознавание, генерацию или другие внешние операции.

## Ожидаемое поведение
1. Выберите Synthetic pauses; оставьте значения 0.5 / 60 / 30 / 120 / 3. Создайте план. Кандидаты: 00:01:41.000, 00:03:22.000, 00:06:41.500. Автовыбор: №2 и №3.
2. Раскройте «Почему выбраны эти паузы»: порядок №2 (4 с), №3 (3 с), №1 (2 с). №1 отклонён из-за расстояния до №2. Вложенные исходные границы содержат 4 сегмента и 3 паузы, хеш 64 hex-символа.
3. Выберите №1 и снимите №2, сохраните. Текущий выбор №1/№3; первоначальный №2/№3. Это новая ветка; старый план в истории остаётся прежним.
4. До сохранения экспорт заблокирован. TXT после сохранения содержит №1/№3, не №2. JSON содержит version: 2 и basis, Markdown — JSON-блок основания. Наличие всех кандидатов/autoSelectedN в JSON не означает текущий выбор.
5. Обновите страницу, откройте снимок. Исходная форма не заменяет сохранённый план. Проверьте ширины 1440 и 390: объяснение переносится, длинный хеш не расширяет страницу.
6. Для отсутствия пауз в отдельном новом источнике задайте pauses=@(), новый UUID/имя и создайте новый план: ноль кандидатов, пояснение «нет пересечения», без придуманной тишины. Существующие снимки не меняются.
7. Для архива v1 используйте **копию** тестового JSON в тестовом DATA_DIR/ad-break-runs с новым UUID в имени/id и title, version: 1; удалите basis. После обновления истории откройте: показывается предупреждение старого снимка, основание не восстанавливается. Не изменяйте рабочие архивы.

## Автоматизированные браузерные сценарии пауз
Для тестов требуется установленный Chromium/Chrome. Задайте CHROME_PATH на существующий исполняемый файл своего браузера. Из корня проекта после сборки:
```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
node --test --test-concurrency=1 --test-name-pattern="Рекламные паузы:" tests/e2e/tools.test.mjs
```
Путь — пример: не создавайте фиктивные ссылки и не отключайте системную защиту. Этот файл поднимает отдельный сервер на 127.0.0.1:8799, создаёт временный DATA_DIR и не наследует ключи; браузерные запросы вне loopback блокируются. Закройте другой тестовый сервер на 8799, если он есть. В Linux здесь прошли шесть сценариев; на Windows команда не запускалась, результат не обещается. Полный набор E2E этим не подтверждён.

Для калькулятора остаются отдельные инструкции LOCAL-CHECK-v0.12.38-preview.1.md; их браузерная/визуальная приёмка ещё открыта. Файлы PREVIEW-CHECKS.json и RELEASE-v0.12.39-preview.1.md разделяют выполненные и невыполненные проверки.
