# Design System: Admin MCP Wizard Tools

## 1. Visual Theme & Atmosphere

A controlled self-service operations interface with Wise-inspired confidence: bright,
clean, rounded, and highly scannable, but not decorative. The screen should feel like an
admin configuring their own automation console inside boundaries already granted by the app,
where credentials are personal and permission limits are visible.

Density is Cockpit Dense 8/10. This is an admin dashboard for repeated operational use,
so information should be compact, aligned, and easy to compare. Variance is Offset
Asymmetric 5/10: avoid centered marketing layouts, but keep predictable tables, tabs, and
forms. Motion is Fluid CSS 4/10: use restrained micro-motion to show liveness, connection
status, and state transitions without distracting from security work.

The primary screen is the current ADMIN's account/settings view with an `MCP` tab. It is
not a landing page and must not have a hero section. The first viewport must immediately
show account identity, whether `MCP_ACCESS` is inherited from app permissions, MCP enabled
state, credentials, and the next safe self-service action.

The UX must keep three concepts visibly separate:

1. **MCP capability** - `MCP_ACCESS` is granted or removed by SUPER_ADMIN through normal
   role and permission management.
2. **MCP profile** - the current ADMIN creates, enables, pauses, and resumes their own
   profile.
3. **MCP credentials** - the same ADMIN creates, rotates, revokes, and connects their own
   OAuth grants or personal tokens.

These are two independent journeys, not one SUPER_ADMIN setup flow:

```text
SUPER_ADMIN
Users -> Role/Permissions -> grant or remove MCP_ACCESS -> done

ADMIN
My Account -> MCP -> set up my MCP -> create credential -> connect client -> use tools
```

Granting `MCP_ACCESS` must never be described as enabling MCP. Enabling a profile must
never be attributed to SUPER_ADMIN.

## 2. Color Palette & Roles

- **Wise Canvas** (#FFFFFF) - Primary light background and page surface.
- **Quiet Workbench** (#F8F9FA) - Secondary background for tab bands, empty states, and
  low-emphasis panels.
- **Pure Surface** (#FFFFFF) - Form panels, credential rows, and table surfaces.
- **Charcoal Ink** (#0E0F0C) - Primary text and high-trust labels. Never use pure black.
- **Wise Forest** (#163300) - Text placed on the accent fill, especially primary buttons.
- **Operational Gray** (#454745) - Secondary text, descriptions, helper text, and field
  captions.
- **Muted Ledger** (#868685) - Metadata, timestamps, disabled hints, and quiet counters.
- **Soft Boundary** (rgba(14, 15, 12, 0.12)) - Default borders, table dividers, and input
  outlines.
- **Active Mint** (#9FE870) - The single accent color for primary actions, active tabs,
  success status, focus rings, and enabled toggles.
- **Mint Wash** (#E2F6D5) - Success backgrounds and low-intensity active state surfaces.
- **Risk Red** (#D03238) - Destructive actions, revoke warnings, and validation errors.
- **Warning Amber** (#FFD11A) - Expiring credential warnings, ambiguous references, and
  pending review attention.
- **OLED Canvas** (#020617) - Dark mode app background.
- **OLED Surface** (#0F172A) - Dark mode panels and sidebars.
- **OLED Lifted Surface** (#1E293B) - Dark mode raised panels.
- **OLED Border** (#334155) - Dark mode structural borders.
- **OLED Text** (#F8FAFC) - Dark mode primary text.
- **OLED Muted** (#94A3B8) - Dark mode secondary text.

Use only Active Mint as the accent. Do not introduce purple, blue neon, multi-accent
gradients, or glow-based CTA styling. Dark mode may use a very soft mint-tinted shadow only
where the existing app already does this; never use outer neon glows.

## 3. Typography Rules

- **Display:** Satoshi, fallback Geist, then system sans. Use restrained, weight-driven
  hierarchy. Page titles use 40-48px desktop, 30-36px tablet, and 26-32px mobile.
- **Body:** Satoshi, fallback Geist. Use 14-16px for dashboard body text with 1.45-1.55
  line-height. Descriptive text should stay under 65 characters per line.
- **Mono:** JetBrains Mono, fallback Geist Mono. Use for token prefixes, OAuth client IDs,
  rate-limit numbers, revision tokens, timestamps, queue IDs, and all dense numeric values.
- **Labels:** 12-13px, 600 weight, uppercase only for table headers and compact metadata
  headings. Do not uppercase long labels.
- **Tab labels:** 14px, 650 weight, compact pill or underline state. Active tab uses Active
  Mint fill or 2px Active Mint rail, not large text.
- **Banned:** Inter in Stitch output, serif fonts, generic system-only typography, fake
  oversized dashboard numerals, and headline-scale text inside compact cards.

When implementing back into the current repo, map these semantic rules onto the existing
Wise CSS tokens if font migration is out of scope. Stitch generation should still target
Satoshi or Geist.

## 4. Component Stylings

* **Page Shell:** Keep the existing near-black admin sidebar. The content area uses Wise
  Canvas with max-width 1400px and 24-32px page padding. The page header is left-aligned
  with the current admin email, role, account status, and MCP status visible in the first
  row.

* **Users List MCP Entry:** Add one compact, read-only `MCP` status column for operational
  visibility. Use only these ownership-safe labels:
  - `Not allowed` - the account lacks `MCP_ACCESS`.
  - `Available` - `MCP_ACCESS` is granted but the ADMIN has not created a profile.
  - `Self-enabled` - the ADMIN owns an enabled profile with a usable credential.
  - `Setup incomplete` - the ADMIN started setup but has no usable credential.
  - `Connection issue` - the profile is enabled but its credentials need attention.
  - `Access revoked` - a previously configured profile is blocked by current app
    permission, role, or account status.
  Never use `Enabled by admin`, `Disabled by admin`, `Enable for user`, or equivalent
  wording. Row actions go only to normal role/permission management. There is no route from
  this table into another ADMIN's MCP profile, token, OAuth grant, or defaults.

* **SUPER_ADMIN Permission Journey:** From Users, SUPER_ADMIN opens the existing
  role/permission editor and grants or removes `MCP_ACCESS` alongside normal wizard,
  listing, publish, and store permissions. Saving a grant confirms:
  `MCP access granted. This admin can now set up their own MCP connection.` Saving a
  removal warns that existing MCP requests will stop immediately, but does not expose or
  delete the ADMIN's credentials. Do not continue into an MCP setup screen.

* **My Account Tabs:** Use a sticky top tab strip below the current account header. Tabs
  are `Profile`, `Permissions`, `Stores`, `MCP`, `Tool Reference`, and `Audit` only when the
  logged-in ADMIN views their own account/settings screen. Do not reuse this composition as
  a SUPER_ADMIN detail page for another ADMIN. The active tab gets Active Mint treatment
  and a subtle scale or translate feedback on press.

* **No MCP Permission State:** If the current ADMIN lacks `MCP_ACCESS`, show a quiet
  read-only panel: inherited role, the exact missing permission `MCP_ACCESS`, the immediate
  effect on existing connections, and that a SUPER_ADMIN can grant it through role and
  permission management. Do not show an enable button, token controls, config editors, or
  language suggesting the current ADMIN can override the restriction.

* **MCP Permission But Disabled State:** If the current ADMIN has `MCP_ACCESS` but has not
  enabled MCP, title the state `MCP is available for your account`. Show inherited
  guardrails and one primary action: `Set up my MCP`. Do not use `Access granted` as the
  page title because it describes the SUPER_ADMIN action instead of the ADMIN's next job.
  The setup action begins a guided flow owned by the current ADMIN; it must not imply that
  SUPER_ADMIN already created or configured the profile.

* **First-Time Setup Flow:** `Set up my MCP` opens a short, resumable setup sequence:
  1. Review inherited app features and effective tool groups. They are read-only. State
     clearly that every store in the current tenant is discoverable because this phase has
     no per-user store ACL.
  2. Choose OAuth Authorization Code + PKCE or a personal access token.
  3. Create the self-managed profile and authorize or create the first credential. All
     currently effective tool groups are selected by default; the ADMIN can narrow them.
     The selection is a snapshot and will not auto-expand when permissions change later.
  4. Show the one-time secret when PAT is selected and provide copyable Claude, Codex, or
     n8n connection configuration.
  5. Test the connection and finish on the enabled MCP overview.
  The profile is not presented as ready until a usable OAuth grant or token exists. Leaving
  early results in `Setup incomplete`, with a `Continue setup` action on return.

* **Tool Reference Availability:** When the current ADMIN has `MCP_ACCESS`, `Tool
  Reference` remains readable before profile activation so they can evaluate parameters,
  security boundaries, and client setup before creating credentials. Running tools still
  requires an enabled profile and usable credential. Without `MCP_ACCESS`, show only the
  missing-permission explanation, not an apparently runnable tool catalog.

* **MCP Overview Panel:** Use a two-column asymmetrical grid: a larger left column for
  profile status and connection health, and a narrower right column for last-used,
  credential expiry, rate-limit state, and recent tool activity. Collapse to one column
  below 768px.

* **Permission Boundary Matrix:** Existing app features and their effective MCP tool groups
  are shown as inherited, non-expandable guardrails. Credential scope and personal tool
  preferences may only narrow those tool groups. Do not show store-access checkboxes.
  A default store selector is allowed as a convenience preference and must be labeled
  `Default`, never `Allowed stores`.

* **Credential Rows:** Token and OAuth grants appear as ledger rows: prefix/client ID in
  mono, status badge, tool-scope snapshot, expiry, last used, and actions. Multiple
  credentials are expected so Claude, Codex, and n8n can be revoked independently.
  Destructive actions use Risk Red ghost buttons until confirmation, then solid Risk Red.

* **Token Creation Dialog:** Use a focused modal with label-above inputs, expiry selector,
  optional note, and a one-time secret reveal panel. The reveal panel uses a mono block,
  copy button, and warning text that the token cannot be recovered later.

* **Rate Limit Display:** Group limits by tool class: discovery, wizard mutation, URL
  import, generation, publish. Show inherited system or role limits as read-only rows. If
  per-admin overrides are not part of the granted app permissions model, do not render an
  editor.

* **Tool Reference View:** Render MCP tool docs inside the ADMIN account area. Group tools
  by Discovery, Design, Wizard Mutation, and Review/Publish. Profile activation, credential
  management, OAuth, and personal defaults are account UI/API actions and must not appear
  as callable MCP tools. Each tool row expands to purpose, permission requirements,
  read-only or mutating behavior, required params, optional params, output fields, common
  errors, and a compact request/response example. Provide copy buttons for Claude, Codex,
  and n8n setup snippets.

* **Audit Timeline:** Use vertical rows with timestamp in mono, actor, action, target, and
  redacted metadata. Use icons only when they improve scanning: key for token, shield for
  permission/profile state, store for a selected default store, and rocket/send for publish
  submission.

* **Buttons:** Primary buttons use Active Mint fill with Wise Forest text, pill radius,
  minimum 44px height, and tactile scale or -1px active feedback. Secondary buttons use
  transparent mint/forest wash. No neon outer glow and no custom cursor.

* **Cards And Panels:** Use cards only for grouped configuration areas. Radius should match
  the app's Wise system: 16px for compact panels, 30px for normal panels, 40px only for
  modal containers or broad page sections. High-density lists use dividers instead of
  nested cards.

* **Inputs:** Label above input, helper text below when needed, inline error below field.
  Focus ring uses Active Mint. Placeholder text is Muted Ledger and never carries critical
  instructions.

* **Loading States:** Use skeleton rows matching the actual table or credential-row layout.
  Avoid circular spinners except inside already-submitted buttons.

* **Empty States:** Empty MCP profile state should show a composed self-service setup panel
  with account owner, inherited permission summary, security note, and one primary action:
  `Set up my MCP`. Do not use only `No data` text.

* **Error States:** Show clear inline errors near the affected section. Ambiguous references
  should render candidates as selectable rows with store labels. Rate-limit errors should
  show retry-after time and the affected tool class.

## 5. Layout Principles

Use a grid-first admin layout. The journey determines how much of the MCP tab is shown:

1. Account and MCP status header.
2. Sticky tab rail.
3. Permission state: no access, available for setup, setup incomplete, enabled, connection
   issue, or access revoked.
4. Before setup: inherited boundaries, `Set up my MCP`, and readable Tool Reference.
5. During setup: one focused step at a time with progress and safe resume.
6. After setup: overview grid with connection health and recent usage.
7. Inherited permission boundaries and editable personal defaults.
8. Tool preferences and read-only rate-limit state.
9. Credentials, OAuth grants, Tool Reference, and audit timeline.

Do not create a standalone `/admin/mcp` console for this phase. Do not hide core scope
state inside a drawer. Drawers are acceptable only for narrow edits such as rotating one
credential or editing a personal default.

Use CSS Grid for multi-column areas. Avoid nested cards and avoid equal three-card feature
rows. Prefer one dominant operational panel plus one secondary metadata rail. Keep
controls aligned in rows so an ADMIN can see what is inherited versus what they can
configure themselves.

Desktop layout target:

- Page max-width: 1400px.
- Outer page gap: 24-32px.
- Main MCP grid: 2fr 1fr for overview, then full-width configuration sections.
- Dense row height: 56-72px.
- Form field vertical gap: 14-18px.
- Section gap: 24px.

Responsive behavior:

- Below 1024px, metadata rails move below the primary panel.
- Below 768px, all columns collapse to one column.
- No horizontal scroll on mobile except inside intentionally scrollable data tables with
  visible containment.
- All tap targets are at least 44px.
- Long token prefixes, emails, and IDs truncate in the middle or wrap in mono blocks without
  breaking the layout.

## 6. Motion & Interaction

Use restrained operational motion. State changes should feel immediate and accountable.

- Default spring feel: stiffness 100, damping 20.
- Hover: subtle 1.02-1.05 scale only for buttons and clickable pills.
- Active press: 0.97 scale or -1px translate.
- Lists mount with short cascade delays, 25-40ms per row, opacity and translate only.
- Active connection indicator may use a low-opacity pulse, but only for live states such as
  connected OAuth session or running publish job.
- Skeleton loading uses a shimmer that follows actual row dimensions.
- Toasts confirm credential rotation, revoke, profile disable, profile resume, and
  self-service config saves. Errors also remain inline in the section that failed.
- Respect reduced motion by disabling transforms, shimmer, and pulses.

Animate only `transform` and `opacity`. Never animate top, left, width, height, border
radius, or layout-affecting properties.

## 7. Anti-Patterns (Banned)

- No standalone marketing hero for this admin feature.
- No standalone `/admin/mcp` console in the first version.
- No SUPER_ADMIN flow that creates another admin's MCP token or edits another admin's MCP
  config.
- No UI that implies SUPER_ADMIN enables MCP profiles for admins. SUPER_ADMIN grants app
  permission only; ADMIN enables MCP themselves.
- No `Enabled by admin`, `Disabled by admin`, `Enable for user`, or `Configure MCP for
  user` wording.
- No single journey that starts in SUPER_ADMIN Users and ends in another ADMIN's token or
  client configuration.
- No tool group named `Profile`; profile and credential lifecycle actions are not MCP
  tools.
- No centered hero or landing-page layout.
- No emojis anywhere.
- No Inter in Stitch output.
- No serif fonts in this dashboard.
- No pure black `#000000`.
- No neon, purple, blue glow, or multi-accent gradient.
- No excessive gradient text.
- No custom mouse cursors.
- No overlapping elements or absolute-positioned content stacking.
- No nested cards.
- No generic three equal cards for stores, tools, and credentials.
- No fake placeholder names such as John Doe, Acme, or Nexus.
- No fake round metrics such as 99.99 percent or 50 percent.
- No AI copywriting phrases such as Elevate, Seamless, Unleash, or Next-Gen.
- No filler text such as Scroll to explore, Swipe down, or Learn more.
- No broken external image links. This UI should not need stock images.
- No base64 token display blocks that overflow on mobile.
- No destructive revoke button without confirmation and clear credential identity.

## 8. Screen Generation Notes For Stitch

Generate these screens from the same design language:

- SUPER_ADMIN Users list with the ownership-safe, read-only MCP status column.
- SUPER_ADMIN role/permission editor granting or removing `MCP_ACCESS`, ending with a
  confirmation rather than an MCP setup page.
- Current ADMIN `My Account` page with the MCP tab active.
- No-permission MCP state with the exact missing permission and no setup controls.
- Permission-available state with `Set up my MCP`.
- First-time setup steps for scope review, authentication method, credential creation,
  client configuration, and connection test.
- Setup-incomplete state with `Continue setup`.
- Access-restored state with `Resume MCP`; credentials stay unusable until the ADMIN acts.
- Personal-token one-time secret reveal dialog.
- ADMIN self-service configured state with inherited permission boundaries, editable
  personal defaults/tool preferences, credential-scope snapshots, credentials, and audit.
- Pre-activation and post-activation Tool Reference views with expanded tool params and
  copyable examples.
- Error examples for expired credential, ambiguous store reference, stale revision token,
  profile disabled, and access revoked.

All generated screens must preserve the current app's Wise palette, rounded controls,
dark sidebar, data table language, and compact admin density.
