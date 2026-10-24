# Fluid and intrinsic responsive layouts

Date: 2026-10-24

## Layout rules

- Shared page spacing uses bounded `rem + vw` values. Body copy and controls retain readable text sizes.
- Card grids use `repeat(auto-fit, minmax(min(100%, minimum), 1fr))`. The available container width determines the number of columns; the inner `min()` permits a single card to shrink on narrow screens.
- Toolbars and preference rows wrap according to their content width. Preference options retain their order and selected state when wrapping.
- Keep media queries for navigation position, drawer presentation, reading/test panes, landing composition, and reduced motion.
- Preserve seven-day records, passage order, and other grids whose structure conveys meaning.
- Preserve horizontal scrolling for the profile trend chart and annual heatmap so their labels and cells remain readable.

## Page changes

| Surface | Change |
| --- | --- |
| Application shell | Shared fluid gutters, dynamic viewport height, shrinking flex content, desktop navigation clearance. |
| Home | Space-driven dashboard columns and metrics; fluid title and wrapping library/mode selectors; seven-day rings scale inside their columns. |
| Library | Space-driven official cards and detail grids; wrapping search/actions; matching loading grids. |
| Notebook | Fluid empty-state padding and word-detail cards. |
| Profile | Space-driven metrics, wrapping section headers, fluid panels, wrapping account email. |
| Review results | Space-driven summaries and wrapping result rows. |
| Learning | Space-driven Round 1 information cards and Round 2 choices; bounded word size; remove unnecessary minimum card height. |
| Article | Fluid panel spacing, wrapping actions, bounded reading measure. |
| Preferences | Rows and options wrap inside both the page and the narrower session drawer; switch tracks and thumbs scale in matching units. |
| IELTS overview | Remove negative mobile gutters; space-driven overview, module and data cards. |
| IELTS reading | Space-driven book/result cards and question navigation; wrapping test controls; remove desktop CSS zoom. |
| Landing | Space-driven practice, bank and continuity cards; retain hero/step composition switches. |
| Authentication | Fluid outer/story padding and bounded heading scale; retain the small-screen story visibility rule. |
| Legal | Heading and prose columns wrap by available width without a page-width breakpoint. |

## Verification scope

- Existing type, lint, unit, build and journey checks.
- Automated layout regression at 320, 390, 600, 800, 1024, 1280 and 1440 CSS pixels with mocked APIs.
- Narrow-screen learning input and session preference drawer regression.
- Home and preference reflow at a 200% root font size.
- Automated overflow and interaction checks do not establish subjective visual acceptance or physical-device compatibility.
- IELTS listening remains behind its existing feature flag and is outside this layout change.
- Database work already present in the checkout is excluded from these commits.

## Local verification results

- `npm run typecheck`: passed.
- `npm run lint`: no errors; five existing hook-dependency warnings in unchanged App logic.
- `npm run format:check`: passed.
- `npm run test:unit -- --maxWorkers=2 --testTimeout=15000`: 39 files, 266 tests passed. An initial unrestricted run timed out on one learning test under local load.
- `npm run build`: passed after the final layout fixes.
- `npm run test:e2e -- --workers=2 --timeout=90000 --retries=0`: 23 tests passed without retries.
- `npm run test:ielts`, `npm run test:session`, and `npm run test:official-library`: passed.
- The reflow checks caught and verified fixes for switch thumb overflow, fixed-size seven-day rings, an outlying day flag, and an oversized illustration decoration.
