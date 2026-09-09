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

## Current port (2026-09-09)

Regular admins can **view** all sendings and receivings. Writes, Edit, and the cabinet SSE stream stay super-admin only.

elm-wallet-main commits: `3f12884`, `8316df7`.
