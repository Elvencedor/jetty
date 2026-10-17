# Handoff spec: Admin shell (all admin screens)

Applies to B-A1 … B-A9. Routes live under `/admin` (see the README for the app-placement decision). Auth: `POST /admin/auth/login` → mandatory 2FA (`/admin/auth/2fa/verify`). The login screens are not in the canvas: build them with the same tokens (a centred white card on `surface-subtle`, logo, fields, primary button).

## Layout
- Page background `surface-subtle`; content padding `clamp(16px, 3vw, 36px)`; max width `container-admin` (1440).
- **AdminTopNav** (see components). The active item matches the route. Count badges: Orders = orders needing action; Reviews = pending reviews.
- Page header pattern: title (display-md) + one-line subtitle (`muted`) on the left; page actions on the right (outline secondary, primary main action). Wraps on narrow screens.
- Detail views open in a **SideDrawer** (480px; full-screen < 480). Lists stay visible underneath.
- Body text 14px (`text-body-sm`).

## Shared behaviour
- **Permissions**: hide nav items and actions the role can't use (server enforces; UI mirrors). Disabled-but-visible is only for actions that are temporarily unavailable, with a tooltip explaining why.
- **Optimistic edits** with rollback on error; mutations send `If-Match` where the API requires it (products). On a 412: "Someone else changed this. Reload to see their version."
- **Unsaved changes** guard on drawers and settings forms (beforeunload + in-app prompt).
- **Loading**: skeletons in cards and tables; never a full-page spinner after the first load.
- **Errors**: inline in the card that failed, with Retry. A global API outage shows a top banner.
- **Time**: show Lagos time (WAT) in all admin timestamps; relative within 24h ("12 min ago"), then absolute ("Oct 10, 14:05").
- **Money**: `formatNaira(minor)`; compact on dashboards (₦48.6M, ₦204k) with the full value in `title`/tooltip.
- **Sample data** in the canvas (names, numbers) is illustrative only.
