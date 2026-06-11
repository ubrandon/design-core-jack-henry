# Troubleshooting

First move for almost everything: tell the AI **"something looks broken, run the doctor."** It runs the health check (`npm run doctor`), which says what kind of repo you're in, what's broken, and the exact fix, then it applies the fix for you. The entries below cover the known traps and what's behind them.

## "I think I set up the wrong repo"

You probably cloned the public template (`ubrandon/design-core`) instead of your company's repo, so you see an empty tool with none of your team's work. `npm run doctor` confirms it. Fix: ask your admin for your company's repo link, then clone it through your editor (**Cmd+Shift+P → Git: Clone**), which signs you into GitHub on the way. A plain terminal clone of a private repo fails without that sign-in, which is usually how people end up here.

## "I can't open the repo / can't save my work"

The company repo is private. You need a GitHub invite with **write** access (admin: repo **Settings → Collaborators**), and you must accept the email invite before anything works. Look-but-not-save means you have read access only.

## "My new screen doesn't show up on the canvas"

Every screen needs two things: the HTML file in the project's `screens/` folder AND an entry in that project's `canvas.json`. If either is missing the screen silently doesn't appear. `npm run doctor` flags both directions (listed but missing, and existing but unlisted). Ask the AI to fix the one it reports.

## "My prototype has no styling"

The prototype's stylesheet links must climb exactly **five** folder levels (`../../../../../styles/shared.css`). One level off and styles silently fail, sometimes only on the published site. Ask the AI to check the `<link>` tags in the prototype's `index.html`.

## "Icons are invisible"

Only two icon styles are loaded: regular (`ph`) and filled (`ph-fill`). Any other Phosphor weight (`ph-bold`, `ph-duotone`, ...) renders as nothing. Ask the AI to swap the icon class to a loaded weight.

## "A whole page of the tool shows nothing / my projects disappeared"

Almost always a broken JSON data file (a missing or extra comma from a hand edit). Nothing is lost; the tool just can't read the file. `npm run doctor` names the exact file and error; ask the AI to fix it.

## "Copy link gives people localhost"

The share URL isn't configured yet. Make sure GitHub Pages is enabled (**Settings → Pages → Source → GitHub Actions**), then run `npm run sync-public-url` once and commit `public/data/site.json`.

## "Port 3000 is already in use"

Design Core always runs at http://localhost:3000 so links stay stable, and it refuses to start if something else is on that port. Usually the something else is another Design Core window: close it (or stop its dev server) and run `npm run dev` again.

## "The tool broke for our whole team after someone's change"

Tool files were probably edited inside the company repo (the rules tell every AI not to). `npm run doctor` lists exactly which tool files differ from the official version. Restore each with `git checkout upstream/main -- <file>`, or ask the AI to. If the change was something your team genuinely needs, request it in the core tool: contact Brandon Unglaub.

## "How do I get the latest tool improvements?"

`npm run update-tool`, then push. Details in [UPDATING.md](UPDATING.md).
