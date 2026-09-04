# Onboarding

A tiny, zero-dependency web service to **capture a person's accessibility needs
into a toolkit ability profile**, and — with the admin password — **list and
delete profiles**. From the same port it also serves the **Controller** UI (the
text/voice control surface, `controller/`) at `/controller`.

Routes: `/chat` (the conversational front door — one input doing both profile
capture and app control; `/` redirects here), `/onboarding` (the step-by-step
onboarding form), and `/controller` (the Controller demo; its ESM loads under
`/controller/lib` and the toolkit settings vocabulary it imports under
`/controller/toolkit/registry`).

> **Run this on localhost or a trusted network only. Do not deploy it to the
> public internet as it is.** The onboarding and profile-view routes are
> unauthenticated by design (a person onboarding has no credential yet), so
> anyone who can reach the port can read and write ability profiles for any
> profile id they can guess, and profiles hold disability-related information.
> The admin password gates only the list and delete routes.

It talks to the toolkit in one of two modes:

- **local** — embeds the toolkit in-process over a file store (`DATA_DIR`). This
  process *is* the toolkit host. Onboard/list/delete all work with no server.
- **remote** — proxies to a running toolkit server (`TOOLKIT_URL`), using
  `ADMIN_PASSWORD` to mint per-user tokens and reach `/admin/users`.

## Run

Local (embedded toolkit, its own data dir):

```bash
ADMIN_PASSWORD=dev DATA_DIR=./onboarding-data node onboarding/server.js
# open http://127.0.0.1:4000/            (chat — the front door; / redirects to /chat)
# open http://127.0.0.1:4000/onboarding   (the step-by-step onboarding form)
# open http://127.0.0.1:4000/controller   (the floating Controller demo)
```

Remote (against a running `server/` on :8080 — ADMIN_PASSWORD must match it):

```bash
ONBOARD_MODE=remote TOOLKIT_URL=http://127.0.0.1:8080 ADMIN_PASSWORD=<server-admin> \
  node onboarding/server.js
```

## The surfaces

- **Chat (`/chat`, the front door)** — one conversational input over the same
  `createController` core: describing a need onboards it into the profile,
  and a command drives the page, without switching surfaces. With
  `GEMINI_API_KEY` set it also gets an LLM assist lane; without it the chat
  still works deterministically.
- **Add a profile** — a free-text "what do you need?" field + support-area
  checkboxes. Submitting creates/updates an ability profile (a `uid`),
  recording `supportAreas`, `freeText`, and a natural-language note.
- **Manage profiles** — enter the admin password to list every profile and
  delete them one by one. In remote mode "delete" wipes the profile via the
  server's `DELETE /admin/users/:uid`; in local mode it removes the profile's
  store partition directly.

### Profile ids are capabilities

The onboarding and profile-view routes are unauthenticated on purpose: a
person onboarding has no credential yet. The profile id itself is therefore
the credential, the way an unguessable share link works. Every new profile
gets a generated id carrying 128 random bits; treat it like a private link,
because whoever knows an id can read that profile (support areas, free-text
self-description, ability model). Typing an id into the form only updates the
existing profile it names; it cannot create a profile under a chosen name, so
no new profile ever sits behind a guessable id. Profiles created under typed
ids before this rule keep working under their old ids. The admin password
gates only the list and delete routes.

## Env

| Var | Purpose | Default |
|-----|---------|---------|
| `ONBOARD_MODE` | `local` or `remote` | `local` |
| `PORT` | listen port | `4000` |
| `ADMIN_PASSWORD` | gates list/delete (and, in remote mode, mints tokens) | — (admin disabled if unset) |
| `DATA_DIR` | (local) file-store dir | `./onboarding/onboarding-data` |
| `TOOLKIT_URL` | (remote) server base URL | `http://127.0.0.1:8080` |
| `GEMINI_API_KEY` | enables the chat's LLM assist lane (`/api/assist`); unset, chat degrades to deterministic-only (settings + grammar) | — |
