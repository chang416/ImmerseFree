import os from "node:os";
import path from "node:path";

export function getPlatformName(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return platform;
}

export function getCacheFile({
  platform = process.platform,
  env = process.env,
  home = os.homedir()
} = {}) {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
    return path.win32.join(base, "ImmerseFree", "Cache", "model-catalog.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Caches", "ImmerseFree", "model-catalog.json");
  }
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "ImmerseFree", "model-catalog.json");
}

export function getExecutableCandidates(name, {
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  bridgeDir = ""
} = {}) {
  // 安裝在清單以外的位置（自建、pnpm、asdf、公司統一部署）時，原本只能
  // 靠 PATH 撞運氣；撞不到就永遠是「尚未安裝 OpenCode CLI」，而且沒有任何
  // 辦法可以指定。給一個明確的逃生門，錯誤訊息也才說得出下一步。
  const override = env[`IMMERSEFREE_${String(name).toUpperCase()}_PATH`];
  if (override) return [override];

  const localAppData = env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
  const appData = env.APPDATA || path.win32.join(home, "AppData", "Roaming");
  const programFiles = env.ProgramFiles || "C:\\Program Files";

  if (platform === "win32") {
    if (name === "agy") {
      return [
        path.win32.join(localAppData, "agy", "bin", "agy.exe"),
        path.win32.join(home, ".local", "bin", "agy.exe"),
        path.win32.join(home, ".agy", "bin", "agy.exe"),
        path.win32.join(home, ".antigravity", "bin", "agy.exe"),
        path.win32.join(localAppData, "Programs", "agy", "agy.exe"),
        path.win32.join(localAppData, "Programs", "Antigravity", "agy.exe"),
        path.win32.join(programFiles, "agy", "agy.exe"),
        path.win32.join(programFiles, "Antigravity", "agy.exe")
      ];
    }
    if (name === "opencode") {
      return [
        path.win32.join(appData, "npm", "node_modules", "opencode-ai", "node_modules", "opencode-windows-x64", "bin", "opencode.exe"),
        path.win32.join(appData, "npm", "node_modules", "opencode-windows-x64", "bin", "opencode.exe"),
        path.win32.join(localAppData, "opencode", "bin", "opencode.exe"),
        path.win32.join(localAppData, "Programs", "OpenCode", "opencode.exe"),
        path.win32.join(home, ".opencode", "bin", "opencode.exe"),
        path.win32.join(home, ".local", "bin", "opencode.exe"),
        path.win32.join(home, "scoop", "shims", "opencode.exe")
      ];
    }
    if (name === "ocr") return [path.win32.join(bridgeDir, "ocr", "ocr.ps1")];
  }

  if (name === "agy") {
    return [
      path.join(home, ".local", "bin", "agy"),
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy"
    ];
  }
  if (name === "opencode") {
    return [
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
      path.join(home, ".local", "bin", "opencode"),
      path.join(home, ".opencode", "bin", "opencode")
    ];
  }
  if (name === "ocr") return [path.join(bridgeDir, "immersefree-ocr")];
  return [];
}

export function getOcrInvocation(ocrPath, imagePath, platform = process.platform) {
  if (platform === "win32") {
    return {
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ocrPath,
        imagePath
      ],
      engine: "Windows.Media.Ocr"
    };
  }
  return { executable: ocrPath, args: [imagePath], engine: "macOS Vision" };
}

export function getPathLookup(platform = process.platform) {
  return platform === "win32"
    ? { executable: "where.exe", args: [] }
    : { executable: "/usr/bin/which", args: [] };
}
