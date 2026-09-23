import { spawnSync } from "node:child_process";

const allowGpl = String(process.env.ALLOW_GPL_FFMPEG || "").toLowerCase() === "true";
const ffmpegPath = "vendor/ffmpeg/runtime/ffmpeg.exe";

const probe = spawnSync(ffmpegPath, ["-version"], {
  encoding: "utf8",
  windowsHide: true,
});

if (probe.error) {
  console.error("[ffmpeg-license-check] Failed to run ffmpeg:", probe.error.message);
  process.exit(1);
}

const output = `${probe.stdout || ""}\n${probe.stderr || ""}`;
const normalized = output.toLowerCase();
const gplEnabled = normalized.includes("--enable-gpl");

if (gplEnabled && !allowGpl) {
  console.error("[ffmpeg-license-check] BLOCKED: bundled ffmpeg reports --enable-gpl.");
  console.error("[ffmpeg-license-check] Commercial dist is blocked until FFmpeg licensing strategy is approved.");
  console.error("[ffmpeg-license-check] If this is an intentional internal build, set ALLOW_GPL_FFMPEG=true.");
  process.exit(2);
}

console.log("[ffmpeg-license-check] OK:", gplEnabled ? "GPL-enabled FFmpeg allowed by override." : "No --enable-gpl flag detected.");
