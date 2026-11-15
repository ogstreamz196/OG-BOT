@echo off
rem Builds OGCopier.exe (the stick app) on a Windows PC with Python installed.
rem Run it once; the result is dist\OGCopier.exe. See STICK.md.
cd /d "%~dp0"
py -m pip install --upgrade pip
py -m pip install -r requirements.txt pyinstaller
py -m PyInstaller --noconfirm --onefile --noconsole --name OGCopier --hidden-import og_copier --hidden-import stick_core og_stick.py
echo.
echo Done. The app is dist\OGCopier.exe: copy it onto the stick (see STICK.md).
pause >nul
