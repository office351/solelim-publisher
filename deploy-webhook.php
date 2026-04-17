<?php
define('SECRET', 'solelim_deploy_2026');

$payload   = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';

if (!hash_equals('sha256=' . hash_hmac('sha256', $payload, SECRET), $signature)) {
    http_response_code(403);
    die('Unauthorized');
}

$data = json_decode($payload, true);
if (($data['ref'] ?? '') !== 'refs/heads/main') {
    die('Not main branch');
}

$repoPath = '/home/solelimderechco/solelim-repo';
$output   = [];

// 1. משוך שינויים מגיטהאב
exec("cd {$repoPath} && git pull origin main 2>&1", $output);

// 2. הפעל מחדש את האפליקציה
exec("touch {$repoPath}/tmp/restart.txt 2>&1", $output);

http_response_code(200);
echo implode("\n", $output);
