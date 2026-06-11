# Updating Design Core

Design Core improvements ship to the public template repo (`ubrandon/design-core`). Company repos pull those improvements in with one command. Design work is never touched by updates: the tool and your designs live in separate folders by design.

## How updates flow

```
public template (the tool)  →  your company repo  →  every designer
        npm run update-tool            git pull / Sync
```

- **Anyone with write access to the company repo can run the update.** It is not tied to whoever set the repo up, or to their computer.
- **Designers do nothing special.** After someone runs the update and pushes, everyone else receives it with a normal pull (the Sync button).

## Running an update

Tell the AI: **"Update the Design Core tool."** It runs the command below for you and explains what arrived. For reference, the command it runs:

```bash
npm run update-tool -- --dry-run   # see what's incoming, change nothing
npm run update-tool                # apply it
```

What it does, in order:

1. Connects the read-only link to the public template if this computer doesn't have it yet.
2. Checks GitHub for new tool changes and lists them.
3. Stops if you have unsaved work (commit first, then rerun).
4. Merges the changes. If the tool's version of a file collides with a company-owned file (`GETTING_STARTED.md`, `.designer.example`, anything under `public/data/`), your company's version wins automatically.
5. Refreshes your company `GETTING_STARTED.md` if the update replaced it with the template version.
6. Reinstalls dependencies.

Then **push** (Sync) so the whole team gets it, and restart the dev server if it was running.

## If the merge reports a conflict it can't resolve

That only happens when tool files were edited directly in the company repo, which the rules tell every AI not to do. Your options:

- Ask the AI to resolve the conflicts keeping the official tool's version.
- Or run `git merge --abort` to undo the update attempt and deal with it later.

`npm run doctor` lists exactly which tool files were changed in your repo, so you can restore them (`git checkout upstream/main -- <file>`) before trying again.

## For the tool maintainer

Changes always land in the public template first, then companies pull them. Never edit tool files inside a company repo, not even "just this once": that is what creates the conflicts above.
