# Multi-client architecture

This repository ships one Fastify server and multiple isolated clients from one branch.
The active client is selected at Vite startup and build time through `THEME`.

```text
clients/
  safe/  # newer Safe client; storage identity: elmsafe
  etx/   # ETX client from main; storage identity: etwallet
server/  # shared API and static-file host
build/themes.json
```

The clients are complete applications. Each owns its `src`, `public`, `brand`, `e2e`,
`index.html`, and TypeScript project. Do not merge their layouts, copy, CSS, providers,
feature implementations, or tests.

## Selecting a client

Set exactly one supported value in `.env`:

```dotenv
THEME=safe
```

or:

```dotenv
THEME=etx
```

`THEME` is intentionally not prefixed with `VITE_`: it controls the build but is not
exposed to browser code. A missing or unknown value stops Vite rather than silently
building the wrong wallet.

The selected client becomes Vite's root and is the only client included in `dist/`.
The server continues to serve the single `dist/` directory.

## Commands

- `npm run dev` — start the client selected by `.env`.
- `npm run build` — typecheck both clients and build the selected client.
- `npm test` — test the selected client plus the shared server.
- `npm run build:themes` — build every registered client sequentially.
- `npm run test:themes` — test every registered client sequentially.
- `npm run verify:themes` — run the complete verification pipeline for every client.
- `npm run icons` — regenerate icons only for the selected client.

## Isolation rules

- `@/*` resolves inside the selected client only.
- Direct imports between `clients/*` are lint errors.
- Shared packages may not import a client or branch on `THEME`.
- Browser storage identities are permanent. `safe` retains `elmsafe`; `etx` retains
  `etwallet`. This covers IndexedDB, localStorage keys, and broadcast channels.
- Client metadata and assets stay in the client root, so the unselected brand cannot
  leak into the output through a shared `index.html` or `public` directory.

## Adding another client

1. Add a complete `clients/<theme>/` root with `src/app/main.tsx`, `public`,
   `brand`, `e2e`, `index.html`, and `tsconfig.json`.
2. Add one entry to `build/themes.json`.
3. Assign a unique, permanent `storageNamespace`.
4. Add the client TypeScript project to the root `tsconfig.json`.
5. Run `npm run verify:themes`.

Code may move into a neutral shared package only after semantic comparison and
contract tests show that every consuming client implements the same behavior.
