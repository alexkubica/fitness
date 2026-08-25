# Fitness Coach Color Palette

This palette keeps the web dashboard aligned with the native iOS, watchOS, and widget surfaces. The source native constants live in `FitnessTheme`, `WatchTheme`, and `WidgetTheme`.

| Role           | Token                   | Hex / CSS                  | Usage                                                      |
| -------------- | ----------------------- | -------------------------- | ---------------------------------------------------------- |
| Background     | `--fitness-background`  | `#131313`                  | Full app canvas. Keep it flat and quiet.                   |
| Foreground     | `--fitness-foreground`  | `#f6f8eb`                  | Primary text and high-emphasis values.                     |
| Card fill      | `--fitness-card`        | `rgb(255 255 255 / 0.065)` | Top-level panels and cards.                                |
| Row fill       | `--fitness-row`         | `rgb(255 255 255 / 0.045)` | Repeated rows, inputs, secondary surfaces.                 |
| Stroke         | `--fitness-stroke`      | `rgb(255 255 255 / 0.10)`  | Borders and separators.                                    |
| Secondary text | `--fitness-secondary`   | `#c4c9ab`                  | Labels, captions, supporting text.                         |
| Primary lime   | `--fitness-lime`        | `#c2f500`                  | Primary action, Today/steps accents, success-ready status. |
| Orange         | `--fitness-orange`      | `#ff5c05`                  | Active energy and calorie accents.                         |
| Cyan           | `--fitness-cyan`        | `#7df5ff`                  | Sync, protein, and informational accents.                  |
| Violet         | `--fitness-violet`      | `#ad8aff`                  | Heart-rate and fat accents.                                |
| Error          | `--fitness-error`       | `#ff7366`                  | Errors and destructive confirmation states.                |
| Action text    | `--fitness-action-text` | `#172100`                  | Text on lime primary actions.                              |

## Web Mapping

The web app maps these into shadcn-compatible tokens in `apps/web/app/globals.css`:

- `--primary` uses lime.
- `--secondary` and `--muted` use the row fill.
- `--card` uses the translucent card fill.
- `--border`, `--input`, and `--ring` are derived from the stroke and lime tokens.
- Metric-specific accents are exposed as `text-fitness-orange`, `text-fitness-cyan`, and `text-fitness-violet`.

## Rules

- Keep the app dark by default.
- Do not introduce decorative gradient orbs or one-off background effects.
- Use lime for primary actions and only one metric accent per data group.
- Use both text and icon/status labels; never rely on color alone for health states.
- Keep cards at `8px` radius unless an existing native surface explicitly needs a larger shape.
