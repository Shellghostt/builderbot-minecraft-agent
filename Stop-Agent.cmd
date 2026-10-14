@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-Agent.ps1"
if errorlevel 1 pause
