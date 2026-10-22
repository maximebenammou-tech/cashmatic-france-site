<?php
header("Content-Type: text/plain");
header("X-Robots-Tag: noindex");
echo PHP_VERSION, " | corrige=", version_compare(PHP_VERSION,"8.4.27",">=")?"oui":"NON", " | upload_progress=", var_export(ini_get("session.upload_progress.enabled"), true), " | curl=", (int)function_exists("curl_init"), " mbstring=", (int)function_exists("mb_substr"), " posix=", (int)function_exists("posix_geteuid"), " | sapi=", PHP_SAPI, "\n";
