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
$appPath  = '/home/solelimderechco/solelim';
$output   = [];

// 1. משוך שינויים מגיטהאב לתיקיית ה-repo
exec("cd {$repoPath} && git pull origin main 2>&1", $output);

// 2. סנכרן קבצים לתיקיית האפליקציה (ללא node_modules, .git, uploads, generated)
exec("rsync -av --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='uploads' \
  --exclude='public/generated' \
  --exclude='.env' \
  {$repoPath}/ {$appPath}/ 2>&1", $output);

// 3. הפעל מחדש את האפליקציה
exec("touch {$appPath}/tmp/restart.txt 2>&1", $output);

http_response_code(200);
echo implode("\n", $output);
