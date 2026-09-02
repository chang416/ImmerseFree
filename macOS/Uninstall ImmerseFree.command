#!/bin/zsh
set -eu

support_dir="$HOME/Library/Application Support/ImmerseFree"
plist_path="$HOME/Library/LaunchAgents/com.immersefree.helper.plist"
trash_dir="$HOME/.Trash/ImmerseFree removed $(/bin/date +%Y%m%d-%H%M%S)"

/bin/launchctl bootout "gui/$UID" "$plist_path" >/dev/null 2>&1 || true
/bin/mkdir -p "$trash_dir"

for target in "$support_dir" "$plist_path" "/Applications/ImmerseFree.app"; do
  if [ -e "$target" ]; then /bin/mv "$target" "$trash_dir/"; fi
done

echo "本機服務、擴充功能資料夾與啟動設定已移到垃圾桶，清空前都還救得回來。"
echo "瀏覽器裡的擴充功能請到 chrome://extensions 手動移除。"
read -r "reply?按 Return 關閉。" || true
