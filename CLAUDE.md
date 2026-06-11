# Design Core -- instructions for Claude

This repo is Design Core, a file-based design tool where designers build screens and prototypes by prompting an AI. The complete, binding rules live in the Cursor rules files below. They apply to you exactly as they apply in Cursor -- "Cursor" in those files means "whatever AI assistant is working in this repo", including you.

@.cursor/rules/design-tool.mdc

@.cursor/rules/setup.mdc

Working outside Cursor, translate the UI references:

- "Open the AI chat" means this conversation.
- "Source Control / Publish Branch" exists in VSCode too; in the Claude desktop app or CLI, use the GitHub CLI flow described in setup.mdc instead.
- Cursor-only settings (Agent mode, Auto model) do not apply to you.

Non-negotiables, restated:

- In a company repo (any repo that is not `ubrandon/design-core`), only create or edit files under `public/data/`, plus the local `.designer` file. Everything else is the tool itself: run the safe-path check from design-tool.mdc before every file change.
- Run `npm run doctor` at the start of setup conversations and whenever something seems broken; follow its fixes.
- Never commit, push, fetch, pull, or merge without the user asking. For tool updates use `npm run update-tool`, never a hand-rolled merge.
