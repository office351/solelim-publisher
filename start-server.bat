@echo off
powershell -Command "Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'C:\Projects\server.js' -WorkingDirectory 'C:\Projects' -WindowStyle Hidden"
