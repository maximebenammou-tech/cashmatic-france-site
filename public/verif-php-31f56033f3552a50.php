<?php
header("Content-Type: text/plain");
header("X-Robots-Tag: noindex");
$v=PHP_VERSION;$ok=version_compare($v,"8.5.12",">=")||(version_compare($v,"8.5.0","<")&&version_compare($v,"8.4.27",">="));
echo $v, " | corrige=", $ok?"oui":"NON", " | upload_progress=", var_export(ini_get("session.upload_progress.enabled"), true), " | curl=", (int)function_exists("curl_init"), " mbstring=", (int)function_exists("mb_substr"), " posix=", (int)function_exists("posix_geteuid"), " mail=", (int)function_exists("mail"), " | sapi=", PHP_SAPI, "\n";
