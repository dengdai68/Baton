#!/bin/sh
# Build a Release device package. The output extension picks the platform:
#   ./package-device.sh [build/BatonMobile.ipa]   iPhone: ad-hoc IPA (Xcode signing)
#   ./package-device.sh build/BatonMobile.apk     Android: release APK (template debug key)
# Android defaults: JDK 17 from Homebrew, SDK in ~/Library/Android/sdk, arm64-v8a only
# (override with JAVA_HOME, ANDROID_HOME and ANDROID_ARCHS, e.g. "arm64-v8a,x86_64").
set -e
cd "$(dirname "$0")"
OUT="${1:-build/BatonMobile.ipa}"
mkdir -p "$(dirname "$OUT")"

case "$OUT" in
  *.apk)
    : "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
    : "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
    export JAVA_HOME ANDROID_HOME
    [ -x "$JAVA_HOME/bin/java" ] || { echo "JDK 17 not found at $JAVA_HOME (brew install openjdk@17)"; exit 1; }
    [ -d "$ANDROID_HOME/platforms" ] || { echo "Android SDK not found at $ANDROID_HOME"; exit 1; }
    [ -d android ] || npx expo prebuild --platform android --no-install
    (cd android && ./gradlew --console=plain -PreactNativeArchitectures="${ANDROID_ARCHS:-arm64-v8a}" assembleRelease)
    cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
    echo "APK: $OUT"
    exit 0
    ;;
esac

xcodebuild -workspace ios/Baton.xcworkspace -scheme Baton -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build-device \
  -allowProvisioningUpdates build
APP=$(find ios/build-device/Build/Products/Release-iphoneos -maxdepth 1 -name 'Baton.app' | head -1)
[ -n "$APP" ] || { echo "Baton.app not found"; exit 1; }
# zip runs inside the staging directory, so the output path must be absolute.
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/Payload"
cp -R "$APP" "$STAGE/Payload/"
(cd "$STAGE" && rm -f "$OUT" && zip -qr "$OUT" Payload)
echo "IPA: $OUT"
