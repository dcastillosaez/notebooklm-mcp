/**
 * El filtro de respuestas previas debe reconocer un texto capturado en crudo.
 *
 * snapshotPriorAnswers guarda innerText sin sanitizar; readLatestAnswer
 * compara texto ya sanitizado. Si el ignoreSet no normaliza igual, una
 * respuesta antigua se cuela como si fuera nueva.
 */
import { sanitizeAnswer } from "../dist/notebooklm/chat.js";

let fallos = 0;
const check = (nombre, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${nombre}`);
  if (!ok) fallos++;
};

// Texto tal y como lo devuelve innerText: con icono Material y citas huérfanas
const crudo = [
  "more_vert",
  "El transistor dispone de tres terminales.",
  "1",
  "2",
  "La caída típica es de 0,7 V.",
].join("\n");

const candidato = sanitizeAnswer(crudo); // lo que ve readLatestAnswer

// Antes: el ignoreSet solo hacía trim
const setViejo = new Set([crudo.trim()]);
check("reproduce el bug: trim NO reconoce la respuesta previa", !setViejo.has(candidato));

// Ahora: el ignoreSet sanitiza igual
const setNuevo = new Set([crudo].map((t) => sanitizeAnswer(t)).filter(Boolean));
check("arreglado: sanitizeAnswer SI reconoce la respuesta previa", setNuevo.has(candidato));

// Un texto ya sanitizado debe seguir reconociéndose (idempotencia)
check("idempotente: sanitizar dos veces no cambia el resultado", sanitizeAnswer(candidato) === candidato);

// Una respuesta realmente nueva no debe filtrarse
check("una respuesta distinta NO se filtra", !setNuevo.has(sanitizeAnswer("El punto Q se sitúa sobre la recta de carga.")));

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
