/**
 * macOS notarization script — runs after electron-builder signs the app.
 * Requires environment variables:
 *   APPLE_ID            — your Apple ID email
 *   APPLE_ID_PASSWORD   — app-specific password (from appleid.apple.com)
 *   APPLE_TEAM_ID       — your 10-character Team ID
 *
 * Only runs on macOS and only when APPLE_ID is set (skips in non-release builds).
 */
const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context

  if (electronPlatformName !== 'darwin') return
  if (!process.env.APPLE_ID) {
    console.log('Skipping notarization — APPLE_ID not set')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`

  console.log(`Notarizing ${appPath}…`)

  await notarize({
    appBundleId: 'com.yourname.ai-code-app',
    appPath,
    appleId:       process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId:        process.env.APPLE_TEAM_ID
  })

  console.log('Notarization complete.')
}
