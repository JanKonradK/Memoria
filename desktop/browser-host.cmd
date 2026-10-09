@echo off
setlocal DisableDelayedExpansion
"%~dp0..\node\node.exe" "%~dp0browser-host.mjs" %*
exit /b %errorlevel%
