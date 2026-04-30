<?php
// סקריפט עדכון ידני - גישה רק עם הסיסמה הנכונה
define('SECRET', 'solelim_deploy_2026');

if (($_GET['secret'] ?? '') !== SECRET) {
    http_response_code(403);
    die('Unauthorized');
}

$repoPath = '/home/solelimderechco/solelim-repo';
$output   = [];

exec("cd {$repoPath} && git fetch origin main 2>&1", $output);
exec("cd {$repoPath} && git reset --hard origin/main 2>&1", $output);

// התקן חבילות npm חדשות (כולל puppeteer אם נוסף)
$npmPaths = ['/usr/local/bin/npm', '/usr/bin/npm', trim(shell_exec('which npm 2>/dev/null'))];
$npm = 'npm';
foreach ($npmPaths as $p) { if ($p && file_exists($p)) { $npm = $p; break; } }
exec("cd {$repoPath} && {$npm} install --production 2>&1", $output);

exec("mkdir -p {$repoPath}/tmp 2>&1", $output);
exec("touch {$repoPath}/tmp/restart.txt 2>&1", $output);

echo "<pre>" . htmlspecialchars(implode("\n", $output)) . "</pre>";
echo "<p>✅ עדכון הושלם</p>";
