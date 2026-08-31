/**
 * Verificación del fix de bloqueo de perfil.
 * Usa un perfil de PRUEBA aislado — no toca el perfil real autenticado.
 */
import { chromium } from "patchright";
import fs from "fs";
import os from "os";
import path from "path";
import {
  findProfileProcesses,
  killProfileProcesses,
  isProfileLockFailure,
} from "../dist/browser/profile-lock.js";

const TEST_PROFILE = path.join(os.tmpdir(), "nlm-lock-test-profile");
fs.rmSync(TEST_PROFILE, { recursive: true, force: true });

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failures++;
};

// 0. Deteccion del error de perfil bloqueado (unitario, sin navegador)
const casosLock = [
  ["ProcessSingleton: failed to create lock", true],
  ["SingletonLock present", true],
  ["The profile is already in use", true],
  ["Target page, context or browser has been closed", true],
  ["Browser closed unexpectedly exitCode=21", true],
  ["failed with code: 21", true],
  // No debe confundirse con otros fallos: si tragase el error de canal,
  // cortocircuitaria el fallback a Chromium empaquetado.
  ["Chromium distribution 'chrome' is not found at /usr/bin", false],
  ["ENOENT: no such file or directory", false],
  ["net::ERR_INTERNET_DISCONNECTED", false],
];
for (const [msg, esperado] of casosLock) {
  check(`lock=${esperado} en "${msg.slice(0, 40)}"`, isProfileLockFailure(new Error(msg)) === esperado);
}

// 1. Sin procesos → lista vacía
check("perfil limpio => 0 procesos", (await findProfileProcesses(TEST_PROFILE)).length === 0);

// 2. Lanzar un contexto persistente que bloquee el perfil
const ctx = await chromium.launchPersistentContext(TEST_PROFILE, { headless: true });
const found = await findProfileProcesses(TEST_PROFILE);
check(`detecta procesos que ocupan el perfil (encontrados: ${found.length})`, found.length > 0);

// 3. El perfil debe estar realmente bloqueado ahora
let lockedBefore = false;
try {
  fs.renameSync(TEST_PROFILE, TEST_PROFILE + "_x");
  fs.renameSync(TEST_PROFILE + "_x", TEST_PROFILE);
} catch {
  lockedBefore = true;
}
check("el perfil esta bloqueado mientras el navegador vive", lockedBefore);

// 4. killProfileProcesses lo libera
const remaining = await killProfileProcesses(TEST_PROFILE);
check(`killProfileProcesses libera el perfil (restantes: ${remaining})`, remaining === 0);

// 5. Tras liberar, el perfil se puede manipular/borrar
let freedAfter = true;
try {
  fs.rmSync(TEST_PROFILE, { recursive: true, force: true });
} catch (e) {
  freedAfter = false;
  console.log("   error borrando:", e.code);
}
check("el perfil se puede borrar tras liberar", freedAfter);

try {
  await ctx.close();
} catch {
  /* ya muerto */
}

console.log(failures === 0 ? "\nTODO OK" : `\n${failures} FALLOS`);
process.exit(failures === 0 ? 0 : 1);
