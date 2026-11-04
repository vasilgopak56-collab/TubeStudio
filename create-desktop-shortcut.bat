@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo TubeStudio - создание и проверка ярлыка
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\install-shortcut.ps1" -Quiet
set "SHORTCUT_RESULT=%ERRORLEVEL%"
echo.
if not "%SHORTCUT_RESULT%"=="0" echo [!] Ярлык не создан. Скопируйте сообщение выше и журнал launcher-logs\shortcut-install.log, если он появился.
if "%SHORTCUT_RESULT%"=="0" echo Ярлык сохранён и проверен. Его точный путь указан выше. Если значка не видно, нажмите F5 на рабочем столе.
echo Не запускайте этот файл от имени другого пользователя или администратора.
pause
exit /b %SHORTCUT_RESULT%
