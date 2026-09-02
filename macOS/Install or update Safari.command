#!/bin/zsh
set -eu
set -o pipefail

package_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$package_root/.." && pwd)"
project_source="${IMMERSEFREE_SAFARI_PROJECT_SOURCE:-$package_root/Safari}"
extension_source="${IMMERSEFREE_EXTENSION_SOURCE:-$repo_root/Extension}"
safari_resources="$project_source/ImmerseFree Extension/Resources"
support_root="${IMMERSEFREE_SUPPORT_ROOT:-$HOME/Library/Application Support/ImmerseFree}"
project_destination="$support_root/Safari"
project_file="$project_destination/ImmerseFree.xcodeproj/project.pbxproj"
extension_identifier="com.immersefree.app.Extension"
noninteractive="${IMMERSEFREE_NONINTERACTIVE:-0}"

pause_if_needed() {
  if [ "$noninteractive" != "1" ]; then
    read -r "reply?按 Return 關閉。" || true
  fi
}

if ! /usr/bin/xcode-select -p >/dev/null 2>&1 || ! /usr/bin/xcrun --find xcodebuild >/dev/null 2>&1; then
  echo "Safari 版本需要完整 Xcode。已開啟 App Store；安裝並開啟 Xcode 一次後，再重跑本指令。" >&2
  /usr/bin/open "macappstore://apps.apple.com/app/xcode/id497799835" || true
  pause_if_needed
  exit 2
fi

if [ ! -f "$project_source/ImmerseFree.xcodeproj/project.pbxproj" ]; then
  echo "找不到 Safari Xcode 專案：$project_source" >&2
  pause_if_needed
  exit 2
fi

# Safari 版與 Chrome 版共用同一份 Extension 程式碼，但 Xcode 專案必須把檔案實際
# 放進 bundle，所以 Resources/ 是一份實體副本。每次建置前先同步一次，兩邊才不會漂移。
# 有兩處 Safari 專屬差異必須保留，因此明確排除：
#   /manifest.json      Safari 版用自己的圖示尺寸，且拿掉了 match_origin_as_fallback
#   /icons/safari-*     Safari 專用的工具列與擴充功能圖示（Chrome 版沒有這些檔案）
# --delete 只會刪掉「共用來源已經沒有」的檔案；被 --exclude 排除的不會被刪。
if [ -f "$extension_source/manifest.json" ]; then
  /bin/mkdir -p "$safari_resources"
  /usr/bin/rsync -a --delete \
    --exclude='/manifest.json' \
    --exclude='/icons/safari-*' \
    "$extension_source/" "$safari_resources/"
  echo "已把共用的 Extension 同步進 Safari 的 Xcode 專案（保留 Safari 專屬的 manifest.json 與圖示）。"
  # manifest.json 被排除在同步外，所以 content_scripts 的 js 清單有可能漂移
  # （Chrome 版加了新檔、Safari 版 manifest 沒跟上）。建置前對帳一次，抓到就停。
  if ! /usr/bin/python3 - "$extension_source/manifest.json" "$safari_resources/manifest.json" <<'PYEOF'
import json, sys
a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
ja = [s["js"] for s in a.get("content_scripts", [])]
jb = [s["js"] for s in b.get("content_scripts", [])]
sys.exit(0 if ja == jb else 1)
PYEOF
  then
    echo "兩份 manifest.json 的 content_scripts js 清單不一致：" >&2
    echo "請把 $extension_source/manifest.json 的變更手動搬進 $safari_resources/manifest.json 再重跑。" >&2
    pause_if_needed
    exit 2
  fi
else
  echo "找不到共用的 Extension：$extension_source" >&2
  echo "這次沿用 Xcode 專案裡既有的 Resources 副本；請確認整個專案都已下載。" >&2
fi

/bin/mkdir -p "$support_root"
/bin/rm -rf "$project_destination"
/usr/bin/ditto "$project_source" "$project_destination"
/usr/bin/sed -i '' '/DEVELOPMENT_TEAM = /d' "$project_file"
/usr/bin/find "$project_destination" -name '.DS_Store' -delete
/usr/bin/find "$project_destination" -name 'xcuserdata' -type d -prune -exec /bin/rm -rf {} +

team="${DEVELOPMENT_TEAM:-}"
if [ -z "$team" ] && [ -d "/Applications/ImmerseFree.app" ]; then
  team="$(/usr/bin/codesign -dv --verbose=4 "/Applications/ImmerseFree.app" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p' | /usr/bin/head -n 1)"
fi
if [ -z "$team" ] && [ -d "$HOME/Applications/ImmerseFree.app" ]; then
  team="$(/usr/bin/codesign -dv --verbose=4 "$HOME/Applications/ImmerseFree.app" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p' | /usr/bin/head -n 1)"
fi
if [ -z "$team" ]; then
  team="$(/usr/bin/defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null | /usr/bin/sed -n 's/.*teamID = \([A-Z0-9]*\);/\1/p' | /usr/bin/head -n 1 || true)"
fi
if [ -z "$team" ]; then
  certificate_subject="$(/usr/bin/security find-certificate -a -p -c 'Apple Development' 2>/dev/null | /usr/bin/openssl x509 -noout -subject 2>/dev/null || true)"
  team="$(printf '%s\n' "$certificate_subject" | /usr/bin/sed -n -e 's#.*[/,]OU[ =]*\([A-Z0-9]*\).*#\1#p' | /usr/bin/head -n 1)"
fi

if [ -z "$team" ]; then
  echo "找不到可用的 Apple Development Team。已開啟 Xcode；登入 Apple 帳號並替兩個 target 選一次 Team，之後本指令就能自動更新。" >&2
  /usr/bin/open "$project_destination/ImmerseFree.xcodeproj"
  pause_if_needed
  exit 3
fi

derived_dir="$(/usr/bin/mktemp -d /private/tmp/immersefree-safari-build.XXXXXX)"
built_app="$derived_dir/Build/Products/Release/ImmerseFree.app"
built_appex="$built_app/Contents/PlugIns/ImmerseFree Extension.appex"

cleanup() {
  if [ -d "$built_appex" ]; then
    /usr/bin/pluginkit -r "$built_appex" >/dev/null 2>&1 || true
  fi
  /bin/rm -rf "$derived_dir"
}
trap cleanup EXIT

echo "正在用 Team $team 建置 Safari 版本…"
if ! /usr/bin/xcodebuild \
  -project "$project_destination/ImmerseFree.xcodeproj" \
  -scheme "ImmerseFree" \
  -configuration Release \
  -destination "platform=macOS" \
  -derivedDataPath "$derived_dir" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$team" \
  CODE_SIGN_STYLE=Automatic \
  clean build; then
  echo "自動簽署失敗。已開啟 Xcode；確認 Xcode → Settings → Accounts 已登入後，再重跑本指令。" >&2
  /usr/bin/open "$project_destination/ImmerseFree.xcodeproj"
  pause_if_needed
  exit 4
fi

if [ ! -d "$built_app" ]; then
  echo "Safari App 建置完成但找不到輸出檔。" >&2
  exit 4
fi
/usr/bin/codesign --verify --deep --strict --verbose=2 "$built_app"

app_destination="${IMMERSEFREE_SAFARI_APP_DESTINATION:-/Applications/ImmerseFree.app}"
if [ ! -w "$(dirname "$app_destination")" ] && [ ! -w "$app_destination" ]; then
  /bin/mkdir -p "$HOME/Applications"
  app_destination="$HOME/Applications/ImmerseFree.app"
fi
installed_appex="$app_destination/Contents/PlugIns/ImmerseFree Extension.appex"

# 先移除所有同 bundle id 的舊註冊，避免暫存 build 與正式 App 同時生效。
while IFS= read -r registration; do
  registered_path="${registration##*$'\t'}"
  if [ -n "$registered_path" ]; then
    /usr/bin/pluginkit -r "$registered_path" >/dev/null 2>&1 || true
  fi
done < <(/usr/bin/pluginkit -m -A -D -v -i "$extension_identifier" 2>/dev/null | /usr/bin/sed '/ plug-ins)$/d' || true)

/bin/rm -rf "$app_destination"
/usr/bin/ditto "$built_app" "$app_destination"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app_destination"
/usr/bin/pluginkit -a "$installed_appex"
/usr/bin/pluginkit -e use -i "$extension_identifier" >/dev/null 2>&1 || true

app_bundle_id="$(/usr/bin/defaults read "$app_destination/Contents/Info" CFBundleIdentifier)"
extension_bundle_id="$(/usr/bin/defaults read "$installed_appex/Contents/Info" CFBundleIdentifier)"
version="$(/usr/bin/defaults read "$app_destination/Contents/Info" CFBundleShortVersionString)"
if [ "$app_bundle_id" != "com.immersefree.app" ] || [ "$extension_bundle_id" != "$extension_identifier" ]; then
  echo "安裝後的 Safari bundle id 不正確。" >&2
  exit 5
fi

/usr/bin/open "$app_destination" || true
echo "Safari $version 已安裝：$app_destination"
echo "若 Safari 尚未顯示圖示，只需到 Safari → 設定 → 延伸功能勾選一次。"
pause_if_needed
