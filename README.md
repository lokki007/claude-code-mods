# Claude Code mods

Two small mods for [Claude Code](https://claude.com/claude-code) that make it easier to see what Claude is doing and to decide what to do next.

| Mod | What you get |
| --- | --- |
| **recap** | After Claude finishes a real piece of work, a side pane lists 14–20 possible next moves, color-coded by direction and ranked 80/20. Pick a few and it writes your next prompt for you. |
| **turn-status** | A quiet one-line band above the prompt while Claude works: what it is doing right now, how long it has been going, task progress and failures. It hides itself when Claude is idle. |

## Install

In a terminal, start `claude` and paste the line for the mod you want:

```
/plugin install recap --marketplace lokki007/claude-code-mods
```

```
/plugin install turn-status --marketplace lokki007/claude-code-mods
```

Claude Code asks whether to add the marketplace: answer `y`, then press Enter to install it for your user. The mod works straight away in that terminal session, and in every new chat after that, including the desktop app's Code tab. Restart chats that were already open.

> The desktop app's Code tab can't run `/plugin install` itself; install once from a terminal and the desktop app picks it up.

Needs a recent Claude Code (one that supports hooks-module plugins, 2.1.29x or later).

## recap: your next-prompt builder

When a turn edits files or digs through research, the **✨ Next** pane opens beside the chat:

- **One line of status**: 💚 done, 🟡 in progress or 🟥 blocked, plus a one-sentence summary.
- **Many options, not just one**: Claude looks at everything it saw (bugs, loose ends, shortcuts, missed chances) and offers 14–20 next moves across eight directions:

  | | Direction | | Direction |
  |---|---|---|---|
  | 🐞 | Fix | 💰 | Money |
  | 🧹 | Tech debt | 📣 | Growth & leads |
  | ✨ | Features | 🚀 | Ship & ops |
  | 🎨 | UI & design | 🧪 | Wild ideas |

  Each option has a colored bar per direction it serves, a rough size (quick, medium, big), and whether it needs your ideas (💬) or Claude can decide it alone (🤖).
- **80/20 ranking**: the best value for the effort comes first; moves that help several directions at once rank higher, and the top three wear **⭐ 80/20**. Click a direction to see only its options.
- **It learns, gently**: after a few prompts it notices which directions you usually pick and nudges them up a little, never hiding the rest. **Reset learning** clears it.
- **Save for later**: **☆ Save** keeps an option in the **Saved** tab for that project, across chats, so you can pick from it any time (`/recap` opens it).
- **Build the prompt**: press **+ Pick** on a few options. The first is the main job, the rest ride along. Choose **Where** (keep it local, staging, production) and **Questions**:
  - **Interview me first**: Claude asks up to five plain-language multiple-choice questions *in the pane*; click your answers and press **Send answers**. You are never asked technical questions.
  - **Just do it**: no questions, Claude decides and tells you what it chose.
  - **Auto**: interviews you only when a pick needs your ideas.
- **Send it**: **Put in prompt**, **Add to my draft** or **Send now ▶**. **A− / A+** change the text size, and your choices are remembered.

Commands: `/recap` reopens the pane, `/recap again` brews fresh options.

How it works: the options come from a short follow-up question to Claude about the conversation that just happened, so they can point at real code. It costs a little extra per qualifying turn (most of the conversation is served from the prompt cache); if that fails it falls back to the small, fast model.

## turn-status: a quiet live status band

While Claude works, one row above the prompt shows:

```
⟳ Building the status band   Running npm test   1:46   ▬▬▬▬▬ 1/5   ● 1 failed
```

- what Claude is doing in plain words (the current task when it keeps a task list, else "Editing svg.ts", "Running npm test", "Thinking")
- a timer whose digits roll over like an odometer
- task progress, one segment per task, when there is a task list
- a red count when a tool fails

When the turn ends it shows "✓ Done in 1:46" for a few seconds and then gets out of the way. In the desktop app it is drawn as a small animated graphic; in a terminal, as text.

## For tinkerers

Each mod is a [Claude Code hooks-module plugin](https://code.claude.com/docs) under `plugins/<mod>`: `hooks/register.tsx` is the entry point, `types/index.d.ts` declares the state it keeps, and `hooks/*.test.ts` are its tests. Run them with:

```
claude plugin validate plugins/recap
claude plugin test plugins/recap
```

## License

MIT
