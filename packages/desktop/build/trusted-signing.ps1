[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$File,

  [Parameter(Mandatory)]
  [ValidateSet("sha256")]
  [string]$FileDigest
)

$ErrorActionPreference = "Stop"

$required = @(
  "WIN_PUBLISHER_NAME",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_CODE_SIGNING_ACCOUNT_NAME",
  "AZURE_CERTIFICATE_PROFILE_NAME"
)
$missing = @($required | Where-Object { -not [Environment]::GetEnvironmentVariable($_) })
if ($missing.Count -gt 0) {
  throw "Missing signing environment values: $($missing -join ', ')"
}

if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
  throw "Signing input was not found: $File"
}

Import-Module TrustedSigning -RequiredVersion 0.5.8 -ErrorAction Stop
$digest = $FileDigest.ToUpperInvariant()

Invoke-TrustedSigning `
  -Endpoint $env:AZURE_TRUSTED_SIGNING_ENDPOINT `
  -CodeSigningAccountName $env:AZURE_CODE_SIGNING_ACCOUNT_NAME `
  -CertificateProfileName $env:AZURE_CERTIFICATE_PROFILE_NAME `
  -Files $File `
  -FileDigest $digest `
  -TimestampRfc3161 "http://timestamp.acs.microsoft.com" `
  -TimestampDigest "SHA256" `
  -Description "STFC Community Mod Companion" `
  -DescriptionUrl "https://github.com/Guffawaffle/stfc-mod-sidecar" `
  -ExcludeEnvironmentCredential `
  -ExcludeWorkloadIdentityCredential `
  -ExcludeManagedIdentityCredential `
  -ExcludeSharedTokenCacheCredential `
  -ExcludeVisualStudioCredential `
  -ExcludeVisualStudioCodeCredential `
  -ExcludeAzurePowerShellCredential `
  -ExcludeAzureDeveloperCliCredential `
  -ExcludeInteractiveBrowserCredential

$signature = Get-AuthenticodeSignature -LiteralPath $File
if ($signature.Status -ne "Valid") {
  throw "Authenticode status was $($signature.Status) after signing $File"
}
if (-not $signature.SignerCertificate.Subject.StartsWith(
    "CN=$env:WIN_PUBLISHER_NAME,",
    [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unexpected Authenticode publisher after signing $File"
}
