param(
  [ValidateSet('start','stop')][string]$Action = 'start',
  [string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$servicesRoot = Join-Path $projectRoot 'work\services'
$pgData = Join-Path $servicesRoot 'postgres'
$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath (Join-Path $PostgresBin 'pg_ctl.exe'))) {
  throw 'Install PostgreSQL or pass -PostgresBin with its bin directory.'
}
if ($Action -eq 'stop') {
  if (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION')) {
    & (Join-Path $PostgresBin 'pg_ctl.exe') -D $pgData -m fast -w stop
  }
  $pidPath = Join-Path $servicesRoot 'mailpit.pid'
  if (Test-Path -LiteralPath $pidPath) {
    $mailProcess = Get-Process -Id ([int](Get-Content -LiteralPath $pidPath)) -ErrorAction SilentlyContinue
    $expectedExe = Join-Path $servicesRoot 'mailpit\mailpit.exe'
    if ($mailProcess -and $mailProcess.Path -eq $expectedExe) { Stop-Process -Id $mailProcess.Id }
  }
  Write-Output 'Local services stopped. Data is preserved.'
  exit 0
}
New-Item -ItemType Directory -Force -Path $servicesRoot | Out-Null
if (-not (Test-Path -LiteralPath $envPath)) {
  $template = Get-Content -LiteralPath (Join-Path $projectRoot '.env.example') -Raw
  $randomSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
  $template.Replace('BETTER_AUTH_SECRET=', "BETTER_AUTH_SECRET=$randomSecret") | Set-Content -LiteralPath $envPath -Encoding utf8
}
$values = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^([A-Z_]+)=(.*)$') { $values[$matches[1]] = $matches[2].Trim('"').Trim("'") }
}
if ($values['POSTGRES_USER'] -ne 'frame' -or $values['POSTGRES_DB'] -ne 'frame_studio' -or $values['DATABASE_URL'] -notmatch '@(127\.0\.0\.1|localhost):55432/frame_studio') {
  throw 'This local helper requires the example database frame_studio, user frame, loopback port 55432. Custom databases must be managed separately.'
}
$dbPassword = $values['POSTGRES_PASSWORD']
if (-not $dbPassword) { throw 'Set POSTGRES_PASSWORD in .env.' }
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  $existingListener = Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue
  if ($existingListener) { throw 'Port 55432 is already used. Stop the existing local service before initializing this project cluster.' }
  $passwordPath = Join-Path $servicesRoot 'init-password.tmp'
  try {
    Set-Content -LiteralPath $passwordPath -Value $dbPassword -NoNewline
    & (Join-Path $PostgresBin 'initdb.exe') -D $pgData -U frame --auth=scram-sha-256 --encoding=UTF8 --locale=C --pwfile=$passwordPath
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
  } finally { if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath } }
}
& (Join-Path $PostgresBin 'pg_ctl.exe') -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $PostgresBin 'pg_ctl.exe') -D $pgData -l (Join-Path $servicesRoot 'postgres.log') -o '-p 55432 -h 127.0.0.1' -w start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start. Inspect work/services/postgres.log.' }
}
$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $dbPassword
  foreach ($databaseName in @('frame_studio','frame_studio_test')) {
    $exists = & (Join-Path $PostgresBin 'psql.exe') -h 127.0.0.1 -p 55432 -U frame -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$databaseName'"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot connect to the local PostgreSQL cluster.' }
    if ($exists -ne '1') {
      & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U frame $databaseName
      if ($LASTEXITCODE -ne 0) { throw 'Cannot create the local database.' }
    }
  }
} finally { $env:PGPASSWORD = $previousPassword }
$mailExe = Join-Path $servicesRoot 'mailpit\mailpit.exe'
if (-not (Test-Path -LiteralPath $mailExe)) {
  $zipPath = Join-Path $servicesRoot 'mailpit.zip'
  Invoke-WebRequest -Uri 'https://github.com/axllent/mailpit/releases/download/v1.32.0/mailpit-windows-amd64.zip' -OutFile $zipPath
  $expectedHash = '16915767a6c95dca569336e8f561f91cf355e9a33c57b91deedcc10a4bba7fd4'
  if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower() -ne $expectedHash) { throw 'Mailpit checksum mismatch; nothing was executed.' }
  Expand-Archive -LiteralPath $zipPath -DestinationPath (Join-Path $servicesRoot 'mailpit')
}
$mailListener = Get-NetTCPConnection -LocalPort 8025 -State Listen -ErrorAction SilentlyContinue
if (-not $mailListener) {
  $mailArgs = @('--listen','127.0.0.1:8025','--smtp','127.0.0.1:1025','--database',('"'+(Join-Path $servicesRoot 'mailpit.db')+'"'))
  $mailProcess = Start-Process -FilePath $mailExe -ArgumentList $mailArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $servicesRoot 'mailpit.out.log') -RedirectStandardError (Join-Path $servicesRoot 'mailpit.err.log')
  Set-Content -LiteralPath (Join-Path $servicesRoot 'mailpit.pid') -Value $mailProcess.Id
}
Write-Output 'PostgreSQL: 127.0.0.1:55432; test mail: http://localhost:8025. Run pnpm db:migrate, pnpm db:seed, then pnpm dev.'
