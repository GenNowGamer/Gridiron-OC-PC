import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function resolveRcedit(projectDir) {
  const candidates = [
    path.join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe"),
    path.join(projectDir, "node_modules", "@electron", "rcedit", "bin", "rcedit.exe"),
    path.join(projectDir, "node_modules", "rcedit", "bin", "rcedit.exe"),
  ];

  try {
    const rceditPkg = path.dirname(require.resolve("@electron/rcedit/package.json"));
    candidates.unshift(path.join(rceditPkg, "bin", "rcedit.exe"));
  } catch (_error) {
    // optional dependency
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDir = context.packager.projectDir;
  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(projectDir, "assets", "icon.ico");
  const rceditPath = resolveRcedit(projectDir);

  if (!fs.existsSync(exePath)) {
    console.warn(`[after-pack-win-icon] exe not found: ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[after-pack-win-icon] icon not found: ${iconPath}`);
    return;
  }
  if (!rceditPath) {
    console.warn("[after-pack-win-icon] rcedit.exe not found; Windows exe icon was not patched.");
    return;
  }

  console.log(`[after-pack-win-icon] embedding icon into ${exePath}`);
  execFileSync(rceditPath, [exePath, "--set-icon", iconPath], {
    stdio: "inherit",
    windowsHide: true,
  });
  console.log("[after-pack-win-icon] done");
}
