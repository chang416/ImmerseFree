#!/bin/zsh
set -eu

extension_dir="$HOME/Library/Application Support/ImmerseFree/Chrome Extension"

if [ ! -f "$extension_dir/manifest.json" ]; then
  echo "找不到已安裝的 Chrome Extension，請先執行『Install ImmerseFree.command』。" >&2
  read -r "reply?按 Return 關閉。"
  exit 1
fi

/usr/bin/open -R "$extension_dir"
/usr/bin/open -a "Google Chrome" "chrome://extensions"

echo "請在你現在使用的 Chrome 頭像／設定檔完成："
echo "1. 開啟右上角『開發人員模式』"
echo "2. 按『載入未封裝項目』"
echo "3. 選取 Finder 已顯示的 Chrome Extension 資料夾"
echo
echo "換到其他 Chrome 頭像後，再執行一次本指令。"
read -r "reply?按 Return 關閉。"
