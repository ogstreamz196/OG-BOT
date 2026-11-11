@echo off
rem Starts the OG B0T MT5 copier. Double-click this file.
cd /d "%~dp0"
title OG Copier
py -3.14 og_copier.py
echo.
echo The copier has stopped. Press any key to close this window.
pause >nul
