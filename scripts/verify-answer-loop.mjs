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

/**
 * Página falsa: devuelve textos de una secuencia, uno por sondeo.
 *
 * Tras el PR #86 la lectura es estructural: `page.evaluate` devuelve los hijos
 * del contenedor y si el textarea sigue deshabilitado. Se simula un turno ya
 * terminado (`generating: false`) con el texto dentro del visor de respuestas,
 * que es la señal positiva que usa la capa de aceptación.
 */
function fakePage(secuencia) {
  let i = 0;
  const siguiente = () => {
    const v = secuencia[Math.min(i, secuencia.length - 1)];
    i++;
    return v;
  };
  return {
    isClosed: () => false,
    waitForTimeout: async () => {},
    // Un solo argumento => health check de pageIsAlive. Dos => lectura del DOM.
    evaluate: async (_fn, args) => {
      if (args === undefined) return true;
      const texto = siguiente();
      if (texto === null) return { root: null, generating: false };
      return {
        root: {
          children: [
            { tagName: "LABS-TAILWIND-DOC-VIEWER", className: "answer", innerText: texto },
          ],
          innerText: texto,
        },
        generating: false,
      };
    },
    locator: () => ({
      last: () => ({ innerText: async () => siguiente() }),
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
