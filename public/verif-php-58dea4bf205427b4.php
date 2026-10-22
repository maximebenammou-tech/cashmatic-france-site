<?php
header("Content-Type: text/plain");
header("X-Robots-Tag: noindex");
echo PHP_VERSION, " | upload_progress=", var_export(ini_get("session.upload_progress.enabled"), true), " | sapi=", PHP_SAPI, "\n";
