# Smart Panel design system

## Direction

Smart Panel is a home-control dashboard. Keep the existing Swiss editorial direction: system sans-serif typography, flat surfaces, fine separators, and one red accent. Prioritize clear device state and direct controls over decorative effects.

## Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--page` | `#FFFFFF` | `#111111` | App background |
| `--surface` | `#FFFFFF` | `#191919` | Panels and controls |
| `--surface-raised` | `#F7F7F8` | `#242424` | Secondary surfaces |
| `--surface-border` | `#D6D6D6` | `#454545` | Dividers and outlines |
| `--text` | `#171717` | `#F7F7F8` | Primary text |
| `--muted` | `#575757` | `#D0D0D0` | Supporting text |
| `--accent` | `#E4002B` | `#FF4A65` | Main actions and focus |

Tokens live in `html/css/swiss-ui.css`. Apply `data-theme` before stylesheets load through `html/js/theme-init.js`; preserve the stored user selection and system preference fallback.

## Layout and interaction

- Keep the seven dashboard sections and existing navigation behavior intact.
- Use the 760 px and 700 px breakpoints already established by the stylesheets. At mobile widths, the bottom section bar scrolls horizontally; each tab remains at least 44 px wide.
- Keep fixed controls clear of device safe areas and allow modal content to scroll independently.
- Maintain visible keyboard focus, semantic labels, a skip link, and reduced-motion support.
- The mobile viewport currently disables pinch zoom by explicit product preference. Revisit that choice if accessibility requirements change.

## Iconography and app identity

- Dashboard controls use inline 24 × 24 SVG with a 1.8 px rounded stroke and `currentColor`; the icon follows its text color in either theme.
- Use 18–20 px icons on desktop and 20–22 px on touch layouts. Icon-only controls keep visible labels for assistive technology and at least 44 × 44 px hit areas on mobile/tablet.
- The launcher mark is a high-contrast geometric “S” on the Swiss red field. Keep the maskable artwork inside the central 65% safe region; let iOS apply its own rounded mask.
- Source artwork and generated platform files live in `html/icons/`, matching this static site's `/icons/` URL. Run `npm run icons:generate` to regenerate PNG and ICO derivatives from the SVG masters.
- Do not add icon fonts or remote icon libraries.

## Performance constraints

- No `backdrop-filter`, blur, stacked shadows, heavy animation libraries, or continuous decorative motion.
- Prefer native scrolling and transitions limited to color, background, border, or transform.
- Avoid work on every animation frame; update live values only when their underlying state changes.
- CSS/browser viewport checks are not a substitute for testing on physical older iPads and low-end phones.

## Source of truth

The implementation is split between legacy component rules in `html/css/styles.css` and theme/layout overrides in `html/css/swiss-ui.css`. Browser regression coverage lives in `tests/browser/panel.spec.cjs` and runs with `npm run test:ui`.
