<?php
// סוד לאימות — שנה את זה למחרוזת אקראית משלך
define('SECRET', 'solelim_deploy_2026');

$payload   = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';

// אימות חתימת גיטהאב
if (!hash_equals('sha256=' . hash_hmac('sha256', $payload, SECRET), $signature)) {
    http_response_code(403);
    die('Unauthorized');
}

$data = json_decode($payload, true);
if (($data['ref'] ?? '') !== 'refs/heads/main') {
    die('Not main branch');
}

$repoPath = '/home/solelimderechco/solelim-repo';
$output = [];

// משיכת שינויים מגיטהאב
exec("cd {$repoPath} && git fetch origin main && git reset --hard origin/main 2>&1", $output);

// הפעלה מחדש של האפליקציה
exec("touch {$repoPath}/tmp/restart.txt 2>&1", $output);

http_response_code(200);
echo implode("\n", $output);
