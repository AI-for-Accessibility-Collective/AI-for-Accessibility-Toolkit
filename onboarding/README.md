# Onboarding

A tiny, zero-dependency web service to **capture a person's accessibility needs
into a toolkit ability profile**, and — with the admin password — **list and
delete profiles**.

It talks to the toolkit in one of two modes:

- **local** — embeds the toolkit in-process over a file store (`DATA_DIR`). This
  process *is* the toolkit host. Onboard/list/delete all work with no server.
- **remote** — proxies to a running toolkit server (`TOOLKIT_URL`), using
  `ADMIN_PASSWORD` to mint per-user tokens and reach `/admin/users`.

## Run

Local (embedded toolkit, its own data dir):

```bash
ADMIN_PASSWORD=dev DATA_DIR=./onboarding-data node onboarding/server.js
# open http://127.0.0.1:4000/onboarding
```

Remote (against a running `server/` on :8080 — ADMIN_PASSWORD must match it):

```bash
ONBOARD_MODE=remote TOOLKIT_URL=http://127.0.0.1:8080 ADMIN_PASSWORD=<server-admin> \
  node onboarding/server.js
```

## The page

- **Add a profile** — a free-text "what do you need?" field + support-area
  checkboxes. Submitting creates/updates an ability profile (a `uid`),
  recording `supportAreas`, `freeText`, and a natural-language note.
- **Manage profiles** — enter the admin password to list every profile and
  delete them one by one. In remote mode "delete" wipes the profile via the
  server's `DELETE /admin/users/:uid`; in local mode it removes the profile's
  store partition directly.

## Env

| Var | Purpose | Default |
|-----|---------|---------|
| `ONBOARD_MODE` | `local` or `remote` | `local` |
| `PORT` | listen port | `4000` |
| `ADMIN_PASSWORD` | gates list/delete (and, in remote mode, mints tokens) | — (admin disabled if unset) |
| `DATA_DIR` | (local) file-store dir | `./onboarding/onboarding-data` |
| `TOOLKIT_URL` | (remote) server base URL | `http://127.0.0.1:8080` |
