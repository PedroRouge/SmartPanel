# Smart Panel brand mark

## Primary direction: Connected home

The house silhouette anchors the mark in home automation. The centered port and
signal node suggest a single place to monitor and control connected devices.
The compact silhouette stays recognizable in favicons and notification badges.

### Palette

- Night panel: `#0A0E1A`
- Raised slate: `#17243A`
- Control blue: `#3D8BFF`
- Signal blue: `#78B8FF`
- Highlight: `#EAF3FF`
- Light wordmark: `#172033`
- Dark wordmark: `#F3F5FA`

## Concepts

- `smart-panel-mark.svg`: selected icon and source for PWA raster assets.
- `smart-panel-logo.svg`: horizontal wordmark for light surfaces.
- `smart-panel-logo-dark.svg`: horizontal wordmark for dark surfaces.
- `concept-orbit.svg`: connected status represented as a home orbit.
- `concept-relay.svg`: device control represented as a clean signal path.

## Icon system

Interface icons remain inline SVG on a 24 × 24 viewBox, 1.8 px rounded stroke,
and the current/currentColor theme behavior. Decorative icons use
`aria-hidden="true"`; controls expose their action through a visible label or
an accessible name. Navigation icons already follow this system, so this brand
refresh does not replace functional pictograms.

## Exporting PWA icons

Run `npm run icons:generate` to regenerate favicons, app icons, and the
Apple touch icon from `smart-panel-mark.svg`. Keep the source SVG as the
editable master; generated PNG and ICO files are deployment assets.
