# Sends this app's secrets to the linked Netlify site. Run it yourself:
#   powershell -ExecutionPolicy Bypass -File scripts\netlify-secrets.ps1
# and paste the pooled connection string from Neon when asked. The text stays hidden.
# Takes the Clerk and AI keys from .env. Prints names only.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$address = ''
for ($try = 1; $try -le 3 -and -not $address; $try++) {
  $hidden = Read-Host -AsSecureString 'Paste the Neon connection string and press Enter (it will not show)'
  $text = [System.Net.NetworkCredential]::new('', $hidden).Password
  # Pressing Enter on an empty line takes whatever was last copied.
  if (-not $text.Trim()) { $text = [string](Get-Clipboard -Raw -ErrorAction SilentlyContinue) }
  $found = [regex]::Match($text, 'postgres(ql)?://[^\s''"]+').Value
  if (-not $found) {
    Write-Host 'That is not a connection string. It starts with postgresql://'
  } elseif ($found -match '\*\*\*') {
    Write-Host 'The password in it is hidden. In Neon press "Show password", copy again, then paste.'
  } else {
    $address = $found
  }
}
if (-not $address) { throw 'No usable connection string. Run the script again when you have it.' }
Write-Host 'Got it. Sending to Netlify...'
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
