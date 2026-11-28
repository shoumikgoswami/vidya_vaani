# Sends this app's secrets to the linked Netlify site. Run it yourself:
#   powershell -ExecutionPolicy Bypass -File scripts\netlify-secrets.ps1
# then copy the pooled connection string in Neon. The script waits for it.
# Takes the Clerk and AI keys from .env and the database address from the clipboard. Prints names only.
param([int]$WaitSeconds = 300)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Find-Address {
  $text = [string](Get-Clipboard -Raw -ErrorAction SilentlyContinue)
  [regex]::Match($text, 'postgres(ql)?://[^\s''"]+').Value
}

$address = Find-Address
if (-not $address) {
  Write-Host 'Waiting: in Neon, press "Copy snippet" under the connection string. Nothing else to do here.'
}
$warned = $false
$until = (Get-Date).AddSeconds($WaitSeconds)
while (-not $address -or $address -match '\*\*\*') {
  if ($address -and -not $warned) {
    Write-Host 'That copy hides the password. In Neon press "Show password", then "Copy snippet" again.'
    $warned = $true
  }
  if ((Get-Date) -gt $until) { throw 'No connection string was copied in time. Run the script again when you are ready.' }
  Start-Sleep -Seconds 1
  $address = Find-Address
}
Write-Host 'Got the connection string. Sending to Netlify...'
if ($address -notmatch '-pooler\.') { Write-Warning 'This is not the pooled address. Turn on connection pooling in Neon if the app is slow to connect.' }

$names = '^(CLERK_PUBLISHABLE_KEY|CLERK_SECRET_KEY|NVIDIA_API_KEY|OPENROUTER_API_KEY)=.'
$lines = @()
if (Test-Path .env) { $lines = @(Select-String -Path .env -Pattern $names | ForEach-Object Line) }
$lines += "DATABASE_URL=$address"

# The file is ignored by git and removed again straight after.
$file = '.env.netlify'
Set-Content -Path $file -Value $lines -Encoding ascii
try {
  # The command prints every value, so its output is thrown away.
  npx --yes netlify-cli@latest env:import $file | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Netlify refused the import. Run "npx netlify-cli login", then try again.' }
} finally {
  Remove-Item $file -Force -ErrorAction SilentlyContinue
}
Write-Host ("Sent to Netlify: " + (($lines | ForEach-Object { $_.Split('=')[0] }) -join ', '))
