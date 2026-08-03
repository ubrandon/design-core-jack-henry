# Design system canvas

The Design System page turns `public/data/design-system/registry.json` into an infinite canvas of component previews. Each group renders as one continuous flat reference surface: categories are organized by headings and whitespace instead of card shells. Categories pack into balanced vertical columns, wide categories become full-width anchors, and paired light/dark surfaces sit beside each other.

## Recommended registry

```json
{
  "layout": {
    "mode": "masonry",
    "columns": 2,
    "columnWidth": 520,
    "gap": 20,
    "pairGap": 40
  },
  "groups": [
    {
      "id": "dark-mode",
      "name": "Dark mode",
      "theme": "dark",
      "pair": "color-modes"
    },
    {
      "id": "light-mode",
      "name": "Light mode",
      "theme": "light",
      "pair": "color-modes"
    }
  ],
  "categories": [
    {
      "group": "dark-mode",
      "name": "Foundations",
      "section": "Foundations",
      "span": "all",
      "layout": "row",
      "components": [
        {
          "id": "dark-colors",
          "file": "acme/colors-dark.html",
          "label": "Color tokens"
        }
      ]
    },
    {
      "group": "dark-mode",
      "name": "Buttons",
      "components": [
        {
          "id": "dark-buttons",
          "file": "acme/buttons-dark.html",
          "label": "Buttons"
        }
      ]
    }
  ]
}
```

## Layout behavior

The default group layout is `masonry`:

- Categories are placed into the currently shortest column, avoiding the large empty gaps produced by a conventional row grid.
- Registries with four or fewer categories use one column. Larger groups use two columns by default.
- A category that overflows a normal column is automatically promoted to full width.
- A category with `"layout": "row"` and multiple components defaults to full width.
- Images and web fonts trigger a layout refresh after loading.

Top-level `layout` values become defaults for every group. A group can override them with its own `layout` object.

| Field | Values | Purpose |
| --- | --- | --- |
| `mode` | `masonry`, `row`, `column` | Category flow inside a group. |
| `columns` | `1`–`4` | Number of masonry columns. |
| `columnWidth` | `280`–`1600` | Starting width of each column in pixels. |
| `maxColumnWidth` | `280`–`2400` | Maximum automatic expansion for unusually wide previews. |
| `gap` | `8`–`80` | Space between sections and columns. |
| `pairGap` | `16`–`120` | Space between paired groups, such as dark and light modes. |

Example group override:

```json
{
  "id": "data-visualization",
  "name": "Data visualization",
  "layout": {
    "mode": "masonry",
    "columns": 3,
    "columnWidth": 460
  }
}
```

## Category placement

Categories normally need no placement metadata. Use these fields only when the visual hierarchy calls for them:

- `"section": "Foundations"` inserts a full-width chapter divider before that category and starts a new masonry run. Put it only on the first category in each major chapter.
- `"span": "all"` makes a category a full-width anchor. Use this for color foundations, typography specimens, large navigation systems, or dense collections that should visually reset the page.
- `"span": 1` keeps a category in a normal column and disables automatic full-width promotion unless its content physically cannot fit.
- `"column": 1` (or another one-based column number) pins a category to a preferred masonry stack. Use this sparingly to keep related categories together.
- `"layout": "row"` controls the components inside the category section; it does not change the group layout mode.
- The object form can combine component layout and placement: `"layout": { "mode": "row", "span": "all", "column": 1 }`.

Good canvases use a small number of chapter dividers, a few wide anchors, and many compact sections. The renderer deliberately avoids wrapping each category in a decorative card, because that extra shell can be mistaken for part of the product UI. Making every category full width recreates the long page this layout is intended to avoid.

## Light and dark modes

Set `theme` on a group to `dark` or `light`. Design Core applies the matching flat background and rebinds the standard tokens inherited by component previews:

- `--bg-0`, `--bg-1`, and `--surface`
- `--border`
- `--text`, `--muted`, and `--muted-2`
- `--shadow` and `--shadow-soft`

Groups with the same `pair` value render side by side. When group IDs or names clearly contain “dark” and “light,” Design Core infers both the theme and the default `theme-modes` pair, so existing registries gain the comparison layout automatically.

Prefer token-driven preview fragments that can be reused in both theme groups. Create separate dark/light fragments only when the structure, imagery, or behavior genuinely differs. Avoid hard-coded page backgrounds or text colors inside preview fragments; those prevent the group theme from doing its job.

Company CSS still loads after the core styles. To customize the canvas chrome, scope overrides to the theme group so broad legacy dark rules cannot leak into the light column:

```css
.ds-canvas-stage .ds-group[data-ds-theme="light"] {
  border-color: var(--border-subtle);
}

.ds-canvas-stage .ds-group[data-ds-theme="dark"] {
  border-color: var(--border-strong);
}
```

Component previews should also use semantic tokens instead of fixed dark or light values. This keeps the same component definition readable in either theme.

## Recommended organization

Within each theme, keep the category order intentional:

1. Foundations: color, typography, spacing, radius, shadow
2. Core actions: buttons, links, controls
3. Navigation and search
4. Forms and selection patterns
5. Domain cards and content rows
6. People, avatars, and social patterns
7. Tags, badges, and status
8. Feedback: banners, toasts, dialogs, empty states, loading

Use a full-width anchor at the start of a major block only when it helps scanning. The masonry algorithm preserves registry order while balancing each run of normal-width categories between anchors.
Use `section` on the first category of a major block when the board needs a stronger visual divider. Six or fewer chapters is a useful target for most systems.

## Compatibility

Existing registries do not need to change. Groups without theme or layout metadata use a neutral light board and automatic masonry defaults. `"layout": "row"` continues to lay out components inside a category side by side.
