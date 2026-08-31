# notebooklm-mcp — guía del repositorio

Servidor MCP que consulta cuadernos de Google NotebookLM automatizando Chrome
con `patchright` (fork de Playwright). Escrito en TypeScript, se ejecuta desde
`dist/`.

## Este clon es un fork

| remote | apunta a |
|---|---|
| `origin` | `dcastillosaez/notebooklm-mcp` (el fork) |
| `upstream` | `PleasePrompto/notebooklm-mcp` (el original) |

Traer cambios del autor original:

```bash
git fetch upstream && git rebase upstream/main && npm run build
```

El rebase conserva los parches propios encima de lo que publique upstream.

## Ciclo de trabajo (importante)

Claude Code ejecuta `dist/index.js`, **no** `src/`. Editar TypeScript no cambia
nada por sí solo:

```bash
npm run build      # src/ -> dist/
```

Y después **reiniciar Claude Code**: el proceso del servidor MCP ya está en
memoria con el código anterior. Sin reiniciar, los cambios no se aplican aunque
`dist/` esté recién compilado. Es la causa más probable de "he arreglado esto y
sigue fallando igual".

Antes de dar por bueno un cambio:

```bash
npm run lint                    # 1 warning preexistente en transport/http.ts
npm run verify:profile-lock     # recuperación del bloqueo de perfil
```

**No ejecutes `npm run format`**: reformatea los ~35 ficheros de `src/` y ahoga
el cambio real en ruido. Pasa Prettier solo por los ficheros tocados.

## Dónde viven los datos

`env-paths` con `suffix: ""`. En Windows resuelve a `%LOCALAPPDATA%`, **no** a
`%APPDATA%`, y añade un `Data`:

```
C:\Users\<user>\AppData\Local\notebooklm-mcp\Data\
├── chrome_profile\     <- perfil persistente (aquí vive la sesión de Google)
├── browser_state\      <- state.json, session.json
└── library.json        <- cuadernos registrados y cuál es el activo
```

En Linux `~/.local/share/notebooklm-mcp/`, en macOS
`~/Library/Application Support/notebooklm-mcp/`.

`library.json` es global: la comparten todos los proyectos. Por eso conviene que
cada proyecto declare sus cuadernos por URL en su propio `CLAUDE.md` en lugar de
depender de los `notebook_id` de la librería.

## Trampas conocidas

**El perfil se bloquea.** Un navegador vivo mantiene un lock sobre
`chrome_profile\`, y `launchPersistentContext` falla. En Windows el error no
menciona `ProcessSingleton`: llega como `exitCode=21` o "Target page, context or
browser has been closed". Hay dos caminos de recuperación distintos, y confundirlos
lleva a arreglar el lado equivocado:

- Runtime (`ask_question`) → `shared-context-manager.ts` cae a un perfil aislado.
- `setup_auth` / `re_auth` → aislar no sirve, porque el login tiene que quedar
  guardado en el perfil base. `browser/profile-lock.ts` mata lo que retenga el
  perfil y reintenta.

**El proceso huérfano no se llama `chrome.exe`.** Los lanzamientos headless usan
`headless_shell.exe`, del Chromium empaquetado de Playwright. Buscar solo
`chrome.exe` no encuentra nada y hace creer que el perfil está libre.

**Los paths cortos 8.3 de Windows no coinciden como cadena.**
`C:\Users\DAVIDG~1\...` y `C:\Users\DAVID GAMING PC\...` son el mismo directorio
pero nunca comparan iguales. Al buscar procesos por línea de comandos hay que
comparar también contra `realpathSync.native()`.

**`false` significa algo concreto.** En `performSetup`, devolver `false` quiere
decir "el usuario no completó el login". Los errores de infraestructura se
propagan como excepción: reutilizar `false` para ellos deja al usuario con
"Authentication failed or was cancelled" y ninguna pista.

## Cuota

50 consultas al día por cuenta de Google en el plan gratuito (5× con AI
Pro/Ultra). `re_auth` permite rotar de cuenta al agotarla.
