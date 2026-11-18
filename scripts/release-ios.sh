#!/bin/bash
# Builds the App Store version of the iPhone app from this checkout.
#   scripts/release-ios.sh          archive and export an .ipa into build/release (nothing sent)
#   scripts/release-ios.sh upload   archive and upload the build to App Store Connect
# Upload needs the app's record in App Store Connect and the Apple ID signed in to Xcode.
# Each run uses a new build number (the time), since Apple refuses a repeat.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/release
BUILD=$(date +%Y%m%d%H%M)
rm -rf "$OUT" && mkdir -p "$OUT"
npm run ios >/dev/null
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$OUT/App.xcarchive" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD" archive -quiet
OPTS="$OUT/ExportOptions.plist"
cp appstore/ExportOptions.plist "$OPTS"
if [ "${1:-}" = "upload" ]; then
  /usr/libexec/PlistBuddy -c "Set :destination upload" "$OPTS"
fi
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportPath "$OUT" \
  -exportOptionsPlist "$OPTS" -allowProvisioningUpdates -quiet
echo "build $BUILD done: $OUT"
