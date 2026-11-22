@echo off
rem Builds OGSignalBot.exe (the OG SIGNAL BOT app) on a Windows PC with Python installed.
rem Run it once; the result is dist\OGSignalBot.exe. Zip that one file and share it. See STICK.md.
cd /d "%~dp0"
py -m pip install --upgrade pip
py -m pip install -r requirements.txt pyinstaller
py -m PyInstaller --noconfirm --onefile --noconsole --name OGSignalBot --hidden-import og_copier --hidden-import stick_core og_stick.py
echo.
echo Done. The app is dist\OGSignalBot.exe: zip it and upload it (see STICK.md).
pause >nul
