import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "com.timev3.technologyagent";
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apkPath = path.join(mobileRoot, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const windowsAdb = `/mnt/c/Users/${process.env.USER ?? "nate"}/AppData/Local/Android/Sdk/platform-tools/adb.exe`;
const adb = process.env.ANDROID_ADB
  || (fs.existsSync(windowsAdb) ? windowsAdb : "adb");

function run(argumentsList, { capture = false } = {}) {
  const result = spawnSync(adb, argumentsList, {
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function requiredTarget(command) {
  const target = process.argv[3];
  if (!target) {
    throw new Error(`Usage: npm run phone:${command} -- PHONE_IP:PORT`);
  }
  return target;
}

function windowsPath(filename) {
  if (!adb.toLocaleLowerCase().endsWith(".exe")) return filename;
  const result = spawnSync("wslpath", ["-w", filename], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Could not convert the APK path for Windows ADB: ${filename}`);
  }
  return result.stdout.trim();
}

function inspect() {
  run(["devices", "-l"]);
  const dump = run(["shell", "dumpsys", "package", packageName], { capture: true });
  const lines = dump.split(/\r?\n/u).filter((line) => (
    /version(?:Code|Name)=/u.test(line)
    || /android\.permission\.(?:RECORD_AUDIO|READ_CONTACTS|READ_CALL_LOG|READ_SMS)/u.test(line)
  ));
  console.log(lines.length ? lines.join("\n") : `Package ${packageName} was not found on the connected phone.`);
}

const command = process.argv[2];
if (command === "pair") {
  run(["pair", requiredTarget("pair")]);
} else if (command === "connect") {
  run(["connect", requiredTarget("connect")]);
} else if (command === "install") {
  if (!fs.existsSync(apkPath)) {
    throw new Error(`Build the APK first with npm run android:build:debug; missing ${apkPath}`);
  }
  const bytes = fs.readFileSync(apkPath);
  console.log(`Installing ${apkPath}`);
  console.log(`SHA-256 ${createHash("sha256").update(bytes).digest("hex")}`);
  run(["install", "-r", "-g", windowsPath(apkPath)]);
  inspect();
} else if (command === "inspect") {
  inspect();
} else {
  throw new Error("Expected one command: pair, connect, install, or inspect");
}
