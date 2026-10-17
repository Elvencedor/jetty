# Handoff spec: Admin · Team & roles (B-A8)

Reference: [`reference/PinkAdminTeam.dc.html`](../../reference/PinkAdminTeam.dc.html) · Route: `/admin/team` · Data: `GET /admin/team`, `POST /admin/team/invitations`, `PATCH /admin/team/{id}`, `GET /admin/audit-log` (all P1) · Features: ADM-02…04

## Layout
- Header: "Team & roles", "Give each person only what they need.", "+ Invite someone" (primary).
- **Invite panel** (inline, 2px `primary` border, opens under the header): Email or phone, Role select, Send invite (dark), Cancel.
- **Members table**: Person (avatar initials, name, email/phone), Role pill (Owner ink · Manager primary · Fulfilment blush · Content editor info · Support success), 2-step login (On success / Off danger / "Invite sent" muted), Last active. Row actions (P1): change role, resend invite, remove.
- **Roles panel**: role chips (Owner, Manager, Fulfilment, Content editor, Support); a plain-language description of the selected role; 8 permission switches with descriptions (View orders, Update order status, Edit products & stock, Message customers, Edit storefront, Moderate reviews, Promotions & refunds, Payouts & settings). Owner switches are locked (60% opacity, disabled).
- **Who changed what** log: who · what (full sentence, e.g. "Changed price of Bone Straight 24" from ₦205,000 to ₦212,000") · when; "Full log" link.

## Rules
- At least one Owner always exists; the last Owner can't be removed or downgraded.
- 2FA is mandatory for admin login (docs/README.md); "Off" means the invite isn't completed yet, and that person can't sign in until they set it up.
- Changing a role's permissions asks for confirmation and applies to everyone with that role.
