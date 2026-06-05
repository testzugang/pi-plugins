#!/usr/bin/env node

import { execFileSync, spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import puppeteer from "puppeteer-core";

const useProfile = process.argv[2] === "--profile";
const profileName = useProfile ? (process.argv[3] ?? "Default") : undefined;

const defaultPath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let chromePath = process.env.PI_CHROME_PATH || defaultPath;

if (!existsSync(chromePath)) {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const detected = candidates.find((c) => existsSync(c));
  if (detected) {
    chromePath = detected;
  }
}

const binName = basename(chromePath);

if (process.argv[2] && process.argv[2] !== "--profile") {
  console.log("Usage: browser-start.js [--profile [profile-directory]]");
  console.log("\nOptions:");
  console.log("  --profile                 Copy your Default Chrome profile");
  console.log(
    "  --profile <directory>     Copy a named Chrome profile, e.g. 'Profile 2'",
  );
  console.log("\nExamples:");
  console.log(
    "  browser-start.js                       # Start with fresh profile",
  );
  console.log(
    "  browser-start.js --profile             # Start with Default profile",
  );
  console.log(
    "  browser-start.js --profile 'Profile 2' # Start with named profile",
  );
  process.exit(1);
}

// Kill only previous automation Chrome instances (on port 9222 or running with remote-debugging)
try {
  const pids = execSync("lsof -t -i :9222", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {}
  }
} catch {}

try {
  const output = execSync(
    `ps aux | grep '${binName}' | grep 'remote-debugging-port=9222'`,
    { encoding: "utf8" },
  );
  for (const line of output.split("\n")) {
    if (line.includes("grep")) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[1];
    if (pid && !isNaN(pid)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {}
    }
  }
} catch {}

// Wait a bit for processes to fully die
await new Promise((r) => setTimeout(r, 1000));

const targetUserDataDir = join(process.env["HOME"], ".cache/scraping");

// Setup profile directory
execFileSync("mkdir", ["-p", targetUserDataDir], { stdio: "ignore" });

if (useProfile) {
  const chromeDir = join(
    process.env["HOME"],
    "Library/Application Support/Google/Chrome",
  );
  const sourceProfileDir = join(chromeDir, profileName);
  const targetProfileDir = join(targetUserDataDir, profileName);

  if (!existsSync(sourceProfileDir)) {
    console.error(`✗ Chrome profile not found: ${sourceProfileDir}`);
    process.exit(1);
  }

  // Sync profile with rsync (much faster on subsequent runs)
  execFileSync("mkdir", ["-p", targetProfileDir], { stdio: "ignore" });
  execFileSync(
    "rsync",
    ["-a", "--delete", `${sourceProfileDir}/`, `${targetProfileDir}/`],
    { stdio: "pipe" },
  );

  const localState = join(chromeDir, "Local State");
  if (existsSync(localState)) {
    execFileSync("cp", [localState, join(targetUserDataDir, "Local State")], {
      stdio: "pipe",
    });
  }
}

const chromeArgs = [
  "--remote-debugging-port=9222",
  `--user-data-dir=${targetUserDataDir}`,
];
if (profileName) chromeArgs.push(`--profile-directory=${profileName}`);

// Start Chrome in background (detached so Node can exit)
spawn(chromePath, chromeArgs, {
  detached: true,
  stdio: "ignore",
}).unref();

// Wait for Chrome to be ready by attempting to connect
let connected = false;
for (let i = 0; i < 30; i++) {
  try {
    const browser = await puppeteer.connect({
      browserURL: "http://localhost:9222",
      defaultViewport: null,
    });
    await browser.disconnect();
    connected = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}

if (!connected) {
  console.error("✗ Failed to connect to Chrome");
  process.exit(1);
}

console.log(
  `✓ Chrome started on :9222${profileName ? ` with profile ${profileName}` : ""}`,
);
