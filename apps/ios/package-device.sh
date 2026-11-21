#!/bin/sh
# Package an existing Xcode-signed device build for installation over USB.
set -eu
if [ "$#" != 2 ]; then
    echo "Usage: $0 path/to/BatonMobile.app path/to/BatonMobile.ipa" >&2
    exit 2
fi
app=$1
output=$2
mkdir -p "$(dirname "$output")"
out_dir=$(cd "$(dirname "$output")" && pwd)
stage=$(mktemp -d)
archive=$(mktemp -d "$out_dir/.baton-ipa.XXXXXXXX")
trap 'rm -rf "$stage" "$archive"' EXIT
codesign --verify --deep --strict "$app"
mkdir "$stage/Payload" "$stage/verification"
ditto --norsrc --noextattr --noqtn "$app" "$stage/Payload/BatonMobile.app"
(cd "$stage" && /usr/bin/zip -Xqr "$archive/BatonMobile.ipa" Payload -x '*/._*' '__MACOSX/*')
/usr/bin/unzip -q "$archive/BatonMobile.ipa" -d "$stage/verification"
codesign --verify --deep --strict "$stage/verification/Payload/BatonMobile.app"
mv -f "$archive/BatonMobile.ipa" "$output"
