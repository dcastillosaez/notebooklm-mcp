/**
 * Chrome profile lock recovery.
 *
 * Playwright/patchright cannot launch `launchPersistentContext` against a
 * profile directory that another Chrome instance still holds open. On Windows
 * a crashed or abandoned run leaves the whole process tree alive (browser +
 * renderers + GPU + crashpad), which keeps a lock on the profile directory.
 * Every subsequent `setup_auth` / `re_auth` then dies inside
 * `launchPersistentContext` and the caller only sees a generic failure.
 *
 * These helpers find and terminate the browser processes that reference a
 * given profile directory so the profile can be reused or deleted.
 */

import { execFile } from "child_process";
import { realpathSync } from "fs";
import path from "path";
import { promisify } from "util";
import { log } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Browser executables that can hold a lock on a persistent profile, without
 * extension and lowercased.
 *
 * `headless_shell` matters: Playwright/patchright runs headless launches
 * through the bundled `chromium_headless_shell-<build>` directory, whose
 * executable is `headless_shell.exe` — a chrome-only list misses every
 * headless orphan, which is the common case here.
 */
const BROWSER_PROCESS_NAMES = [
  "chrome",
  "chromium",
  "msedge",
  "brave",
  "headless_shell",
  "chrome_headless_shell",
];

/** Windows CIM filter for the executables above. */
const WINDOWS_PROCESS_FILTER = BROWSER_PROCESS_NAMES.map((n) => `Name='${n}.exe'`).join(" OR ");

function isBrowserProcessName(executable: string): boolean {
  const base = path
    .basename(executable.trim())
    .replace(/\.exe$/i, "")
    .toLowerCase();
  return BROWSER_PROCESS_NAMES.includes(base);
}

/**
 * Detect the "profile already in use" family of launch failures.
 *
 * Mirrors the runtime detection in `shared-context-manager.ts` — Windows
 * surfaces this as an opaque `exitCode=21` or a closed-target message rather
 * than a readable ProcessSingleton error.
 */
export function isProfileLockFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /ProcessSingleton|SingletonLock|profile is already in use/i.test(msg) ||
    /Target page, context or browser has been closed/i.test(msg) ||
    /code[=:\s]*21\b/i.test(msg)
  );
}

const IS_WINDOWS = process.platform === "win32";

/** Windows paths are case-insensitive and mix separators; POSIX paths are not. */
function canonicalize(p: string): string {
  const normalized = path.normalize(p);
  return IS_WINDOWS ? normalized.replace(/\//g, "\\").toLowerCase() : normalized;
}

/**
 * Every spelling of `profileDir` that could appear in a command line.
 *
 * Windows is the problem case: the caller may hold a short 8.3 path
 * (`C:\Users\DAVIDG~1\...`) while Chrome was launched with the expanded long
 * path, or vice versa, and the case can differ. Comparing the raw string alone
 * silently finds nothing — which reads as "profile is free" and defeats the
 * whole recovery. Compare against the resolved real path too.
 */
function profileVariants(profileDir: string): string[] {
  const variants = new Set<string>();
  const add = (p: string | undefined): void => {
    if (p) variants.add(canonicalize(p));
  };

  add(profileDir);
  try {
    add(realpathSync.native(profileDir));
  } catch {
    /* profile may not exist yet — the raw form is all we have */
  }
  return [...variants];
}

function commandLineMatches(commandLine: string, variants: string[]): boolean {
  const haystack = IS_WINDOWS ? commandLine.replace(/\//g, "\\").toLowerCase() : commandLine;
  return variants.some((v) => haystack.includes(v));
}

/**
 * List PIDs of browser processes whose command line references `profileDir`.
 */
export async function findProfileProcesses(profileDir: string): Promise<number[]> {
  if (!profileDir) return [];
  const variants = profileVariants(profileDir);

  try {
    if (process.platform === "win32") {
      // Pull the raw command lines and match in JS — PowerShell's literal
      // `.Contains()` cannot handle the short/long path mismatch above.
      const script =
        `Get-CimInstance Win32_Process -Filter "${WINDOWS_PROCESS_FILTER}" | ` +
        `Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;

      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }
      );

      const trimmed = stdout.trim();
      if (!trimmed) return [];
      const parsed: unknown = JSON.parse(trimmed);
      // ConvertTo-Json emits a bare object when there is exactly one result.
      const rows = Array.isArray(parsed) ? parsed : [parsed];

      return rows
        .map((row) => row as { ProcessId?: number; CommandLine?: string | null })
        .filter((row) => row.CommandLine && commandLineMatches(row.CommandLine, variants))
        .map((row) => Number(row.ProcessId))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    }

    // POSIX: match the profile path against full command lines, but only for
    // actual browser executables — otherwise a shell or editor that merely
    // mentions the path would be killed.
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,command="], {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && commandLineMatches(line, variants))
      .map((line) => {
        const [pidToken, executable = ""] = line.split(/\s+/);
        const pid = Number.parseInt(pidToken ?? "", 10);
        return isBrowserProcessName(executable) ? pid : Number.NaN;
      })
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch (error) {
    log.warning(`  ⚠️  Could not inspect processes for profile lock: ${error}`);
    return [];
  }
}

/**
 * Terminate every browser process holding `profileDir`.
 *
 * Returns the number of processes that were still alive afterwards — 0 means
 * the profile is free. Safe to call when nothing is running.
 */
export async function killProfileProcesses(profileDir: string): Promise<number> {
  const pids = await findProfileProcesses(profileDir);
  if (pids.length === 0) return 0;

  log.warning(`  🧹 Releasing Chrome profile lock (${pids.length} orphaned process(es))...`);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone, or owned by another user — the recheck below decides */
    }
  }

  // Windows tears the process tree down asynchronously; give the OS a moment
  // to release the file handles before the caller touches the directory.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const remaining = await findProfileProcesses(profileDir);
  if (remaining.length === 0) {
    log.success("  ✅ Chrome profile lock released");
  } else {
    log.warning(`  ⚠️  ${remaining.length} process(es) still holding the profile`);
  }
  return remaining.length;
}
