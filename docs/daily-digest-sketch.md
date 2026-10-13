# Daily digest: a sketch

A design sketch, not built yet: one pane that answers "what did all my chats get done today, and what should I do next?" It builds on what recap already keeps per project: the latest recap, the progress diary and the log.

## How it would look

```
┌─ 📅 Today ─────────────────────────────────────────── Tue 13 Oct ── A− A+ ─┐
│ 🦉 4 projects moved today · 3 done 💚 · 2 in progress 🟡 · 1 blocked 🟥      │
│                                                                            │
│ ┌─ xt3 site ──────────────── 🟡 ─┐  ┌─ Still (Android) ─────────── 💚 ─┐     │
│ │ Booking button is now the main │  │ Closed test 2.7.3 sent for review │     │
│ │ call to action; page 3× faster │  │ 2 chats · 41 min                  │     │
│ │ 3 chats · 1 h 10 min           │  │                                   │     │
│ │ ⚠ not live yet: needs a push   │  │                                   │     │
│ └────────────────────────────────┘  └───────────────────────────────────┘     │
│ ┌─ Postbox ───────────────── 🟥 ─┐  ┌─ claude-code-mods ────────── 💚 ─┐     │
│ │ Blocked: Coolify login expired │  │ recap 0.9.0 published             │     │
│ │ 1 chat · 12 min                │  │ 4 chats · 2 h                     │     │
│ └────────────────────────────────┘  └───────────────────────────────────┘     │
│                                                                            │
│ ➜ Best next steps across projects (80/20)                                  │
│   ⭐ [+ Pick] Push the xt3 homepage live       🚀💰  quick · Claude decides  │
│   ⭐ [+ Pick] Renew the Coolify login           🐞🚀  quick · your call       │
│   ⭐ [+ Pick] Find 12 testers for Still         📣    medium · your call      │
│      [+ Pick] Add tests for the recap diary     🧹    quick · Claude decides  │
│                                                                            │
│ [Open in its chat ▶]   [Copy as client update]   [Save all to backlog]      │
└────────────────────────────────────────────────────────────────────────────┘
```

## What each part does

- **Header line**: today's count of projects touched and their status, at a glance.
- **One card per project** that had work today, newest first: the latest one-line summary, how many chats and minutes, and any danger in amber (unpushed, broken, blocked). Clicking a card opens that project's latest recap in its own chat.
- **Best next steps across projects**: the top options from every project's latest recap, ranked with the same 80/20 score recap uses (value per effort, lifted when one move serves several directions, nudged by what you usually pick). Unblocking moves (🟥 projects) float up first, because one fix there unlocks the most.
- **Pick** puts the step in your prompt with the right project named, so you can paste it into that project's chat. **Open in its chat** jumps there.
- **Copy as client update** turns the day's diary entries into a short, plain progress note for clients, one paragraph per project.
- **Save all to backlog** keeps the unpicked steps for each project's Saved tab.

## Where the data comes from

Everything is already written by recap 0.9.0:

| Needed | Already kept |
| --- | --- |
| Each project's latest summary, status and options | `last:<project>` in the mod's store |
| What happened today, in order | the diary files in `~/.claude/recap/diary/` |
| Chats and timings | `~/.claude/recap/log.jsonl` (session starts, recaps) |

## Open questions before building

1. Open it on its own (`/today`), or automatically on the first chat of the morning?
2. Should "today" mean since midnight, or since the last time you looked?
3. Client updates: one per project, or one combined note per client?
