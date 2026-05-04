@echo off
setlocal

set "PERCY_INFRA_TMP=%~dp0..\.tmp"
if not exist "%PERCY_INFRA_TMP%" mkdir "%PERCY_INFRA_TMP%"

set "TEMP=%PERCY_INFRA_TMP%"
set "TMP=%PERCY_INFRA_TMP%"
set "TMPDIR=%PERCY_INFRA_TMP%"
set "JSII_RUNTIME=C:\Program Files\nodejs\node.exe"
set "PERCY_CDK_WORKSPACE_TEMP=1"

C:\Users\benst\AppData\Roaming\npm\cdk.cmd %*
