# Windows Code Signing

Official Windows releases of STFC Community Mod Companion should be signed with
Azure Artifact Signing. Local developer builds stay unsigned by default.

Signing gives users a verified publisher and tamper protection. It does not
guarantee that SmartScreen will skip warnings on a new build. SmartScreen
reputation still has to accumulate for the publisher and each new file hash.

## Publisher Identity

The current intended individual publisher name is:

```text
Joseph Gustavson
```

The name users see comes from the signing certificate/profile, not from
`productName`, `appId`, or the GitHub repository name. In CI, set
`WIN_PUBLISHER_NAME` to the exact publisher name shown by the certificate
profile.

## Local Unsigned Builds

No signing environment is required for local packaging:

```powershell
npm run desktop:pack
npm run desktop:dist
```

With no `WIN_SIGN_MODE`, `packages/desktop/electron-builder.config.cjs` keeps
`win.signAndEditExecutable` disabled. This avoids the local `winCodeSign`
symlink extraction failure seen on this Windows machine while keeping prototype
artifacts easy to build and smoke-test.

## Azure Artifact Signing Builds

Official CI builds set:

```text
WIN_SIGN_MODE=azure
WIN_PUBLISHER_NAME=Joseph Gustavson
AZURE_TRUSTED_SIGNING_ENDPOINT=https://eus.codesigning.azure.net
AZURE_CODE_SIGNING_ACCOUNT_NAME=stfcsidecarsign
AZURE_CERTIFICATE_PROFILE_NAME=stfc-sidecar-public
AZURE_TENANT_ID=2afe118a-d47a-4fe3-b056-a4b51e111dd6
AZURE_CLIENT_ID=5e40e5bb-52cb-4c95-a939-30237646c389
AZURE_CLIENT_SECRET=<GitHub environment secret>
```

The GitHub workflow is `.github/workflows/release-windows.yml`. It builds on
tag pushes and manual dispatches in the protected `windows-release` environment,
then verifies every generated `.exe` with `signtool verify /pa /v` and
`Get-AuthenticodeSignature`.

Use GitHub Environment variables for non-secret profile metadata:

- `WIN_PUBLISHER_NAME`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_CODE_SIGNING_ACCOUNT_NAME`
- `AZURE_CERTIFICATE_PROFILE_NAME`
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`

Use one GitHub Environment secret for the credential:

- `AZURE_CLIENT_SECRET`

Set the variables with GitHub CLI:

```powershell
gh api -X PUT repos/Guffawaffle/stfc-mod-sidecar/environments/windows-release
gh variable set WIN_PUBLISHER_NAME --env windows-release --body "Joseph Gustavson" -R Guffawaffle/stfc-mod-sidecar
gh variable set AZURE_TRUSTED_SIGNING_ENDPOINT --env windows-release --body "https://eus.codesigning.azure.net" -R Guffawaffle/stfc-mod-sidecar
gh variable set AZURE_CODE_SIGNING_ACCOUNT_NAME --env windows-release --body "stfcsidecarsign" -R Guffawaffle/stfc-mod-sidecar
gh variable set AZURE_CERTIFICATE_PROFILE_NAME --env windows-release --body "stfc-sidecar-public" -R Guffawaffle/stfc-mod-sidecar
gh variable set AZURE_TENANT_ID --env windows-release --body "2afe118a-d47a-4fe3-b056-a4b51e111dd6" -R Guffawaffle/stfc-mod-sidecar
gh variable set AZURE_CLIENT_ID --env windows-release --body "5e40e5bb-52cb-4c95-a939-30237646c389" -R Guffawaffle/stfc-mod-sidecar
gh secret set AZURE_CLIENT_SECRET --env windows-release -R Guffawaffle/stfc-mod-sidecar
```

The final command prompts for the client secret. Do not commit the secret or pass
it as a command-line argument.

Longer term, prefer OIDC over a stored client secret if the signing integration
supports it cleanly for the Electron Builder flow.

## Cert Store Fallback

If Azure Artifact Signing is unavailable, a Windows certificate-store signing
path is available for traditional OV/individual certificates:

```powershell
$env:WIN_SIGN_MODE = "cert-store"
$env:WIN_PUBLISHER_NAME = "Joseph Gustavson"
$env:WIN_CERT_SHA1 = "PUT_CERT_THUMBPRINT_HERE_WITHOUT_SPACES"
npm run desktop:dist:win
```

Find local code-signing certificates:

```powershell
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Format-List Subject, Thumbprint, NotAfter, HasPrivateKey
```

Verify generated artifacts:

```powershell
signtool verify /pa /v "packages\desktop\dist\STFC Community Mod Companion-Setup-0.0.1-Alpha-x64.exe"
signtool verify /pa /v "packages\desktop\dist\STFC Community Mod Companion-Portable-0.0.1-Alpha-x64.exe"
```

## Release Checklist

- Azure identity validation complete.
- Certificate profile created for the intended publisher name.
- `windows-release` GitHub Environment requires approval.
- CI identity has only the signing role needed for that certificate profile.
- `WIN_SIGN_MODE=azure` in the release workflow.
- NSIS setup and portable `.exe` are both built.
- Every `.exe` passes Authenticode verification in CI.
- Release notes mention that signed first releases can still show SmartScreen
  reputation warnings.

Never store a PFX/private key, hardware token PIN, personal Microsoft account
password, or broad Azure admin credential in repository secrets.