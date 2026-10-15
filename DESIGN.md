# Smart Panel design system

## Direction

Smart Panel uses the atmospheric, compact home-control language of [House Control](https://github.com/0xProbabillity/house-control), adapted to its existing dashboard and controls. Keep the Smart Panel wordmark, navigation, home status, weather, schedule, lighting, gate, pool, media and camera functions. Use a deep blue-black canvas, softly lit glass surfaces, fine translucent edges, rounded device tiles and clear live states. The reference's 3D floor plan is not copied because Smart Panel has no equivalent model; its lighting and tile grammar carries through the current modules.

## Tokens

The dark values below are extracted from `web/src/style.css` in House Control. The light values are a readable counterpart for Smart Panel's existing light theme; the reference itself defines a dark theme only.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--page` | `#edf2f9` | `#0a0e1a` | Canvas |
| `--text` | `#172033` | `#f3f5fa` | Main text |
| `--muted` | `#53627a` | `rgba(222, 230, 247, .72)` | Supporting text |
| `--surface` | `rgba(255,255,255,.78)` | `rgba(255,255,255,.055)` | Glass cards |
| `--surface-raised` | `rgba(255,255,255,.94)` | `rgba(255,255,255,.1)` | Hover and raised states |
| `--surface-border` | `rgba(47,72,108,.14)` | `rgba(255,255,255,.085)` | Fine outlines |
| `--accent` | `#307ce5` | `#3d8bff` | Active controls and focus |
| `--warm` | `#e7a348` | `#ffb46b` | Lights and warm readings |
| `--positive` | `#168a55` | `#4ade80` | Connected and enabled |
| `--red` | `#d94d61` | `#ff7888` | Errors and alerts |

- Typography: native system sans stack led by Apple SF Pro where available, then Inter and `system-ui`; tabular numerals for time and readings.
- Geometry: 20–22 px cards, 14–15 px controls, pill status chips and switches.
- Depth: subtle translucent fills, a fine light edge and soft low-spread shadows. Desktop pointer devices may blur the topbar/navigation; touch devices keep the same translucent color layers without backdrop blur for lower GPU cost.
- Motion: short color and transform feedback on user actions; honor reduced motion and avoid continuous decorative work.

Tokens and component mapping live in `html/css/swiss-ui.css`, loaded after the existing component sheet. Theme selection remains in `data-theme` and is initialized before stylesheets through `html/js/theme-init.js`. The PWA shell cache uses network-first CSS/JS requests.

## Component mapping

- Summary and status cards use the same glass tile, border, radius and depth treatment.
- Lights use the warm amber reference state; enabled controls get a soft accent tint and glow.
- Pump/pool uses a cool cyan status, gate uses green when open/active, and connection indicators retain green, amber and red for online, checking and error.
- Existing labels, controls, navigation, behavior and responsive grids stay intact.

## Layout and accessibility

- Retain the seven sections, existing navigation behavior and 600/700/760/900/1200 px breakpoints.
- Mobile-first grids collapse to one column; section navigation remains horizontally scrollable and touch targets stay at least 44 px.
- Preserve safe-area spacing, modal scrolling, visible keyboard focus, semantic labels and reduced-motion support.
- Keep the current viewport and interaction behavior unless an accessibility change is requested.

## Performance

- Avoid continuous animation and large effects over scrolling content.
- Limit `backdrop-filter` to the topbar/navigation on fine-pointer desktop screens; touch devices use translucent surfaces without blur.
- Keep app imagery and icons local; do not add a remote icon or font runtime dependency.

## Source

The component structure and functionality remain in `html/index.html` and `html/css/styles.css`; the reference-inspired theme overrides are in `html/css/swiss-ui.css`. UI regression coverage is in `tests/browser/panel.spec.cjs` and runs with `npm run test:ui`.
