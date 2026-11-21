#!/bin/sh
# Build a Release iPhone build and package an ad-hoc IPA for device installation.
# Usage: ./package-device.sh [output.ipa]
set -e
cd "$(dirname "$0")"
OUT="${1:-build/BatonMobile.ipa}"
mkdir -p "$(dirname "$OUT")"
xcodebuild -workspace ios/Baton.xcworkspace -scheme Baton -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build-device \
  -allowProvisioningUpdates build
APP=$(find ios/build-device/Build/Products/Release-iphoneos -maxdepth 1 -name 'Baton.app' | head -1)
[ -n "$APP" ] || { echo "Baton.app not found"; exit 1; }
PAYLOAD=$(mktemp -d)/Payload
mkdir -p "$PAYLOAD"
cp -R "$APP" "$PAYLOAD/"
(cd "$(dirname "$PAYLOAD")" && rm -f "$OUT" && zip -qr "$OUT" Payload)
echo "IPA: $OUT"
