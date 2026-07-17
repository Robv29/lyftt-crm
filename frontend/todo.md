# LYFTT CRM - Suivi Commercial

## Design Guidelines

### Design References
- **Salesforce Lightning**: Clean data tables, card-based dashboards
- **HubSpot CRM**: Pipeline kanban, activity tracking
- **Style**: Modern SaaS / Professional Dark-Light with Blue accent

### Color Palette
- Primary: #1E40AF (Blue 800 - main accent)
- Secondary: #3B82F6 (Blue 500 - buttons, links)
- Background: #F8FAFC (Slate 50)
- Card: #FFFFFF
- Text Primary: #0F172A (Slate 900)
- Text Secondary: #64748B (Slate 500)
- Success: #10B981 (Emerald 500 - won deals)
- Warning: #F59E0B (Amber 500 - pending)
- Danger: #EF4444 (Red 500 - lost deals)

### Typography
- Font: Inter (sans-serif)
- Headings: font-weight 700
- Body: font-weight 400

---

## Development Tasks

### Files to Create (8 files max)

1. **src/lib/api.ts** - API client (already exists, update if needed)
2. **src/contexts/AuthContext.tsx** - Auth context (already exists)
3. **src/App.tsx** - Main app with routing (update)
4. **src/pages/Dashboard.tsx** - Main commercial dashboard with KPIs, pipeline overview, agenda
5. **src/pages/Prospects.tsx** - Prospect list with filters, search, import Excel/CSV
6. **src/pages/ProspectDetail.tsx** - Prospect detail view with action history and status updates
7. **src/pages/Pipeline.tsx** - Visual kanban pipeline view
8. **src/components/Layout.tsx** - Sidebar navigation layout

### Features
- Auth with login/logout
- Dashboard: KPIs (appels, visios, signatures), pipeline summary, upcoming relances
- Prospects table: search, filter by status/zone/categorie, import Excel/CSV
- Prospect detail: view/edit info, log actions, change status
- Pipeline: kanban board with drag concept (click to move between stages)
- Responsive sidebar navigation