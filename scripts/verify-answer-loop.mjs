/**
 * Pruebas del bucle de espera de respuesta (waitForStableAnswer) con una
 * página simulada. No toca la red ni gasta cuota de NotebookLM.
 *
 * Cubre el escenario del bug: con una respuesta previa en pantalla, el bucle
 * debe distinguir la nueva de la vieja y no devolver nunca la vieja como si
 * fuera fresca.
 */
import { waitForStableAnswer, sanitizeAnswer } from "../dist/notebooklm/chat.js";

let fallos = 0;
const check = (nombre, ok, detalle = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${nombre}${ok ? "" : "  <- " + detalle}`);
  if (!ok) fallos++;
};

/** Página falsa: devuelve textos de una secuencia, uno por sondeo. */
function fakePage(secuencia) {
  let i = 0;
  return {
    isClosed: () => false,
    evaluate: async () => true,
    waitForTimeout: async () => {},
    locator: () => ({
      last: () => ({
        innerText: async () => {
          const v = secuencia[Math.min(i, secuencia.length - 1)];
          i++;
          if (v === null) throw new Error("no element");
          return v;
        },
      }),
      allInnerTexts: async () => [],
    }),
  };
}

const OPC = { timeoutMs: 3000, pollIntervalMs: 10, stablePolls: 3 };

// Respuesta previa tal cual la captura innerText: con icono y citas huérfanas
const PREVIA_CRUDA = ["more_vert", "El transistor tiene tres terminales.", "1", "2"].join("\n");
const PREVIA_LIMPIA = sanitizeAnswer(PREVIA_CRUDA);
const NUEVA = "El punto Q se sitúa sobre la recta de carga.";

// 1) Con una respuesta previa en pantalla, llega una nueva -> devuelve la NUEVA
{
  const page = fakePage([PREVIA_CRUDA, PREVIA_CRUDA, NUEVA, NUEVA, NUEVA, NUEVA]);
  const r = await waitForStableAnswer(page, { ...OPC, ignoreTexts: [PREVIA_CRUDA] });
  check("devuelve la respuesta nueva, no la previa", r === NUEVA, `devolvio: ${JSON.stringify(r)}`);
}

// 2) CRITICO: si no llega ninguna nueva, NO debe devolver la previa -> null
{
  const page = fakePage([PREVIA_CRUDA]);
  const r = await waitForStableAnswer(page, { ...OPC, ignoreTexts: [PREVIA_CRUDA] });
  check("sin respuesta nueva devuelve null (falla ruidosamente)", r === null, `devolvio: ${JSON.stringify(r)}`);
}

// 3) El mismo caso pero pasando la previa YA sanitizada (otro llamador)
{
  const page = fakePage([PREVIA_CRUDA]);
  const r = await waitForStableAnswer(page, { ...OPC, ignoreTexts: [PREVIA_LIMPIA] });
  check("tambien filtra si la previa llega ya sanitizada", r === null, `devolvio: ${JSON.stringify(r)}`);
}

// 4) No debe devolver un placeholder de carga
{
  const page = fakePage(["Thinking...", "Thinking...", "Thinking...", "Thinking...", NUEVA, NUEVA, NUEVA, NUEVA]);
  const r = await waitForStableAnswer(page, { ...OPC, ignoreTexts: [] });
  check("ignora placeholders de carga", r === NUEVA, `devolvio: ${JSON.stringify(r)}`);
}

// 5) No debe devolver el eco de la propia pregunta
{
  const pregunta = "¿Qué es un transistor NPN?";
  const page = fakePage([pregunta, pregunta, NUEVA, NUEVA, NUEVA, NUEVA]);
  const r = await waitForStableAnswer(page, { ...OPC, question: pregunta, ignoreTexts: [] });
  check("ignora el eco de la pregunta", r === NUEVA, `devolvio: ${JSON.stringify(r)}`);
}

// 6) No debe cerrar en falso mientras el texto aun cambia (streaming)
{
  const page = fakePage(["Parcial", "Parcial mas", "Texto final", "Texto final", "Texto final", "Texto final"]);
  const r = await waitForStableAnswer(page, { ...OPC, ignoreTexts: [] });
  check("espera a que el texto se estabilice", r === "Texto final", `devolvio: ${JSON.stringify(r)}`);
}

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
