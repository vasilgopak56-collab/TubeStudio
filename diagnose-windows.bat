@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo TubeStudio - проверка файлов установки и существующего ярлыка
echo Сервер и платные API не запускаются. Ключи и данные не читаются.
where node >nul 2>nul
if errorlevel 1 goto :no_node
node "%~dp0scripts\windows-check.mjs" --diagnose --report
set "CHECK_RESULT=%ERRORLEVEL%"
echo.
echo Код проверки: %CHECK_RESULT%. Строки FAIL требуют внимания; WARN не подтверждает успех.
echo Диагностика не заменяет ручной запуск программы и не меняет ярлык.
pause
exit /b %CHECK_RESULT%
:no_node
echo FAIL Node.js не найден. Установите актуальную версию LTS с nodejs.org.
echo Без Node.js автоматическая диагностика недоступна.
echo Для ручного создания ярлыка можно отдельно запустить create-desktop-shortcut.bat.
pause
exit /b 1
