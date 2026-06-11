# Design Core -- instructions for AI agents

This repo is Design Core, a file-based design tool where designers build screens and prototypes by prompting an AI.

**Before doing anything else, read both of these files in full. They are the complete, binding rules for this repo and apply to every AI assistant (Copilot, Claude, Cursor, or anything else):**

- `.cursor/rules/design-tool.mdc`
- `.cursor/rules/setup.mdc`

Where those files mention Cursor UI, use your environment's equivalent (the rules explain the alternatives).

Non-negotiables, restated:

- In a company repo (any repo that is not `ubrandon/design-core`), only create or edit files under `public/data/`, plus the local `.designer` file. Everything else is the tool itself: run the safe-path check from design-tool.mdc before every file change.
- Run `npm run doctor` at the start of setup conversations and whenever something seems broken; follow its fixes.
- Never commit, push, fetch, pull, or merge without the user asking. For tool updates use `npm run update-tool`, never a hand-rolled merge.
