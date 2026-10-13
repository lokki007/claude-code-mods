# Plan: a remixable starter kit for Claude Code mods

**Status:** proposal, not built yet.

## Goal

Someone who has never made a mod clones (or "Use this template"s) this repo and has their own working mod in about 15 minutes. They keep recap and turn-status as worked examples, and get the same release flow used here.

## What gets added

| Piece | What it is | Why |
|---|---|---|
| `templates/hello-pane/` | The smallest useful mod: a `/hello` command that opens a pane with one button and one toast, plus one test. About 60 lines. | Something to copy that works the first time. |
| `templates/hello-band/` | A band above the prompt that shows the current tool and a timer, cut down from turn-status. | The second most common kind of mod. |
| `scripts/new-mod.mjs` | `node scripts/new-mod.mjs my-mod --from hello-pane` copies a template, renames it everywhere, adds it to the marketplace list and runs its test. | No hand-editing of JSON on day one. |
| `scripts/release.mjs` | Already here. It gets a `--marketplace <name>` option so a remix does not install into `lokki-mods`. | The single biggest time saver: bump, test, commit, install, publish. |
| `scripts/check.mjs` | One command that validates every mod, type-checks it and runs its tests. It also sets up the types folder that type-checking needs. | Today type-checking needs a hand-made config outside the repo. |
| `GUIDE.md` | The guide (outline below). | The "why" behind the code. |
| `.github/workflows/check.yml` | Runs `check.mjs` on every push and pull request. | Remixes stay green. |
| `.claude-plugin/marketplace.json` | Already here. The guide explains how to rename it. | Each remix is its own installable marketplace. |

## Guide outline (`GUIDE.md`)

1. **What a mod can do**: panes, bands, toasts, commands, tool hooks, model calls. One screenshot each from recap and turn-status.
2. **Your first mod in 15 minutes**: `new-mod`, then `release --dry-run`, then `release`, then `/reload-plugins`.
3. **How a hooks module works**: `register`, `on(event, matcher, handler)`, the `$` engine, `next(e)`.
4. **Drawing panes that people can actually click.** These are the lessons from building recap:
   - Use Buttons with `variant`, not Markdown links.
   - Make text bigger with Markdown heading levels.
   - Give every key a unique name, or the whole pane is refused.
   - Give SVGs a fixed size.
5. **Keeping state**: atoms for this chat, `$.store` across chats, `$.fs` for files people can open.
6. **Model calls**: `fork` (it sees the whole conversation) versus `complete` (cheap). Treat model text as untrusted: `plain()` and `md()`.
7. **Testing**: the test kit, fake clock, store and file system, and a "press every button" test to copy.
8. **Shipping**:
   - Bump the version, or nobody sees the change.
   - Use the release script.
   - Run a real check with a headless `claude -p` run and the mod's own log.
9. **Gotchas we hit**:
   - Command names can be taken by Claude's built-ins (`/recap`). Have a fallback.
   - One refused registration must not stop startup.
   - On Windows, `$.fs` paths use backslashes.
   - A stale `claude` on the PATH.
10. **Remixing and publishing**: rename the marketplace, give the one-line install, add a license note.

## Order of work

1. Templates and `new-mod.mjs`, tested by generating a mod and running its test.
2. `check.mjs`, plus `--marketplace` for the release script.
3. `GUIDE.md` and a shorter README that points to it.
4. The CI workflow, and the "template repository" switch on GitHub.

Steps 1 and 2 are about half a day of Claude time. Steps 3 and 4 are a few hours.

## Decisions taken (change any)

- **One repo.** It is both your mods and the kit, rather than a separate kit repo, so the examples stay real and up to date.
- **Templates are TypeScript and tested,** like recap.
- **The guide is written for people who are new to mods but can code a bit.** The README stays non-technical.
- **The license stays as it is.** The guide asks remixers to keep the notice.
