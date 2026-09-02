#!/bin/zsh
set -eu

# 這個腳本住在 macOS/ 底下，共用的 Extension 與 Bridge 在 repo 根目錄。
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
support_dir="$HOME/Library/Application Support/ImmerseFree"
launch_agents_dir="$HOME/Library/LaunchAgents"
plist_path="$launch_agents_dir/com.immersefree.helper.plist"
bridge_source="$repo_root/Bridge"
chrome_source="$repo_root/Extension"
chrome_install_dir="$support_dir/Chrome Extension"

echo "正在安裝 ImmerseFree…"

if [ ! -f "$bridge_source/server.mjs" ] || [ ! -f "$chrome_source/manifest.json" ]; then
  echo "找不到 Extension 或 Bridge。請確認整個專案都已下載（不要只抓 macOS 資料夾）。" >&2
  read -r "reply?按 Return 結束。" || true
  exit 1
fi

# 從網路下載的檔案會被 Gatekeeper 標記，先清掉隔離屬性再繼續。
/usr/bin/xattr -dr com.apple.quarantine "$repo_root" 2>/dev/null || true
/bin/chmod 755 "$script_dir"/*.command 2>/dev/null || true

# 不夾帶 Node 執行檔（那會讓 repo 超過 GitHub 的檔案大小上限），改用系統的。
node_bin=""
node_candidates=(
  "$(command -v node 2>/dev/null || true)"
  /opt/homebrew/bin/node
  /usr/local/bin/node
)
# (N) 是 zsh 的 null_glob 修飾子：沒裝 nvm 時這個樣式會安靜地展開成「沒有項目」，
# 而不是讓 zsh 丟 "no matches found" 直接中斷腳本，讓使用者連下面那段
# 「請先安裝 Node.js」的說明都看不到。
node_candidates+=("$HOME"/.nvm/versions/node/*/bin/node(N))
for candidate in "${node_candidates[@]}"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then node_bin="$candidate"; break; fi
done

if [ -z "$node_bin" ]; then
  echo
  echo "找不到 Node.js。ImmerseFree 的本機服務需要它才能執行。"
  echo "請先安裝 LTS 版："
  echo "  https://nodejs.org/     或   brew install node"
  echo "裝好之後重新執行這個安裝程式。"
  read -r "reply?按 Return 結束。" || true
  exit 1
fi
echo "使用 Node.js：$node_bin"

/bin/mkdir -p "$support_dir" "$launch_agents_dir"
/bin/rm -rf "$support_dir/Bridge" "$chrome_install_dir"
/usr/bin/ditto "$bridge_source" "$support_dir/Bridge"
/usr/bin/ditto "$chrome_source" "$chrome_install_dir"
# 掃描版 PDF 的 OCR 元件是一支很小的 Swift 程式，用 macOS 內建的 Vision。
# 這裡當場編譯，而不是在專案裡放一個沒人能驗證的預編譯二進位檔。
# 沒有 swiftc 也不影響其他功能，只有掃描版 PDF 會少了文字辨識。
if /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  if /usr/bin/xcrun swiftc -O \
      -o "$support_dir/Bridge/immersefree-ocr" \
      "$script_dir/ocr/ImmerseFreeOCR.swift" 2>/dev/null; then
    /bin/chmod 755 "$support_dir/Bridge/immersefree-ocr"
    echo "已編譯 OCR 元件（掃描版 PDF 可用）"
  else
    echo "OCR 元件編譯失敗，掃描版 PDF 將無法辨識文字。其他功能不受影響。"
  fi
else
  echo "找不到 swiftc（需要 Xcode Command Line Tools），略過 OCR 元件。"
  echo "  之後想補上：xcode-select --install，再重跑一次這個安裝程式。"
fi
/bin/rm -f "$support_dir/helper.log" "$support_dir/helper-error.log"

/bin/cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.immersefree.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$support_dir/Bridge/server.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$support_dir/helper.log</string>
  <key>StandardErrorPath</key><string>$support_dir/helper-error.log</string>
</dict>
</plist>
PLIST
/usr/bin/plutil -lint "$plist_path" >/dev/null
/bin/launchctl bootout "gui/$UID" "$plist_path" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$UID" "$plist_path"

# 等本機服務回應，讓使用者知道到底成功沒有。
bridge_ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  /bin/sleep 1
  if /usr/bin/curl -fsS "http://127.0.0.1:27843/health" >/dev/null 2>&1; then bridge_ok=1; break; fi
done

if [ -d "/Applications/Google Chrome.app" ]; then
  /usr/bin/open -R "$chrome_install_dir" || true
  /usr/bin/open -a "Google Chrome" "chrome://extensions" || true
fi
if [ -d "/Applications/Microsoft Edge.app" ]; then
  /usr/bin/open -a "Microsoft Edge" "edge://extensions" || true
fi

echo
if [ "$bridge_ok" -eq 1 ]; then
  echo "本機服務已啟動：http://127.0.0.1:27843"
else
  echo "本機服務尚未回應，可查看 $support_dir/helper-error.log"
fi
echo
echo "最後一步（每個瀏覽器設定檔各做一次）："
echo "  1. 開啟右上角「開發人員模式」"
echo "  2. 按「載入未封裝項目」"
printf '%s' "$chrome_install_dir" | /usr/bin/pbcopy
echo "  3. 在選擇資料夾的視窗按 Command + Shift + G"
echo "  4. 按 Command + V 貼上已複製的路徑，再按 Return 與「開啟」"
echo
echo "路徑已複製：$chrome_install_dir"
echo "注意：解壓縮資料夾內原本叫 Extension；安裝後的 Chrome Extension 位於上方路徑，不是在 macOS 資料夾內。"
echo
echo "Safari 需要 Xcode 與你自己的 Apple 帳號簽署，請執行「Install or update Safari.command」。"
read -r "reply?按 Return 關閉。" || true
