#!/bin/zsh
set -eu

echo "Safari 找不到『ImmerseFree』圖示"
echo
echo "1. 完整退出 Safari，再重新開啟。"
echo "2. Safari → 設定 → 延伸功能，確認『ImmerseFree』已勾選。"
echo "3. 如果已勾選但仍沒有圖示："
echo "   Safari → 顯示方式 → 自訂工具列⋯"
echo "   找到『ImmerseFree』，拖到上方工具列，最後按『完成』。"
echo "4. 若清單裡也找不到，請執行『Install or update Safari.command』；只有首次缺少 Team 時才需在 Xcode 登入 Apple 帳號。"
echo

/usr/bin/open -a "Safari" || true

read -r "reply?按 Return 關閉。" || true
