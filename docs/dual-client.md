# Dual client: `elm-wallet-main` and `main`

This repo ships **one server** and **two clients**. Do not merge the UIs.

| Branch | Remote | Client | Role |
|---|---|---|---|
| `elm-wallet-main` | `et-wallet` (`the-pmain/et-wallet`) | Newer UI (this checkout, from elm-wallet) | Daily work |
| `main` | `et-wallet` | Older / different UI | Production-style et-wallet client |
| `adapt/elm-wallet-main` | `et-wallet` | Main's client, with ports of elm-wallet-main behavior | Merge vehicle into `main` |

`origin` is `the-pmain/elm-wallet`. Do not push client work there unless James asks.

The two histories do not share a merge base. Cherry-pick and file copy will often fail. **Reimplement** the same behavior against main's files.

## After every commit or push on `elm-wallet-main`

1. Stay on `elm-wallet-main` in this directory. Do not `git checkout main` here.
2. Fetch `et-wallet/main`.
3. Use a sibling worktree, not this checkout:
   - path: `../elm-safe-adapt-main`
   - branch: `adapt/elm-wallet-main` (create from `et-wallet/main` if missing)
4. Port the **behavior**, not the newer `src/` tree:
   - server/API/auth changes usually apply with small context edits
   - client changes must match main's components, copy, layout, and tests
   - never replace main's wallet UI with elm-wallet-main's
5. Run the tests that cover the ported files (`tsc -b` if the client changed).
6. Commit on `adapt/elm-wallet-main` and push to `et-wallet`.
7. Open or update a PR: `adapt/elm-wallet-main` → `et-wallet/main`. Do not merge into `main` unless James asks.

## Standing worktree

```text
git fetch et-wallet main
git worktree add -b adapt/elm-wallet-main ../elm-safe-adapt-main et-wallet/main
```

If the worktree already exists, update that branch from `et-wallet/main` and add the new port on top.

## Current port (2026-09-10)

The exchange receive panel follows only `address-receiving-funds-exchange` in `wallets` (map or list). A missing or malformed field always offers Generate wallet / Generate a wallet and never reads the open account.

elm-wallet-main: `cff7f59`.
adapt: `0727bf5`.

### Earlier port (2026-09-09)

`POST /v1/users/wallets/generate` derives a receive address from the record's own `seed_phrase`, so a browser signed in by email alone can fill a slot with no vault to unlock. It answers 409 when the row carries no phrase, and only then does the device derive locally. Both receive slots read `wallets`; an empty slot offers the generate button, and a wallet with no cabinet record falls back to the open account.

The server files were identical across the two branches, so they carried over as-is. On the client the port keeps main's `ReceiveAddressPanel`, its Russian comments, and its copy — the button stays "Generate a wallet".

elm-wallet-main: `1bd1f8a`.
adapt: `bfcc3c9`.

### Earlier port

Cabinet directory lists are paginated (`GET /v1/admin/directory/*`), with a short TTL scan cache and joined emails. Receivings does not GET sendings. Pending toasts hydrate from Users/Activity, or from the Sendings list itself.

Regular admins can **view** all sendings and receivings. Writes, Edit, and the cabinet SSE stream stay super-admin only.

elm-wallet-main: `af55ecb` (also `3f12884`, `8316df7`).
adapt: `31ced7d`.
