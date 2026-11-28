# Sends this app's secrets to the linked Netlify site. Run it yourself, from the project folder:
#   1. In Neon, copy the pooled connection string.
#   2. powershell -ExecutionPolicy Bypass -File scripts\netlify-secrets.ps1
# Takes the Clerk and AI keys from .env and the database address from the clipboard. Prints names only.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$address = [regex]::Match([string](Get-Clipboard -Raw), 'postgres(ql)?://[^\s''"]+').Value
if (-not $address) { throw 'The clipboard holds no Postgres connection string. Copy it in Neon, then run this again.' }
if ($address -match '\*\*\*') { throw 'The password is hidden in the copied text. Use the copy button in Neon, then run this again.' }
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
