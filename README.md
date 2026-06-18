# Linear Gantt

A fully browser-based Gantt chart viewer for Linear milestones. No build step, no backend, no server required.

## Setup

### 1. Get a Personal API Key

1. Open Linear → **Settings** → **API** → **Personal API keys**
2. Click **Create key**, give it a name, copy the value (`lin_api_…`)

### 2. Run the app

Open `index.html` directly in your browser — or serve it locally to avoid any `file://` quirks:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

No npm, no Node, no build step needed.

### 3. Connect

On first load you'll see a **Connect to Linear** screen. Paste your API key and click **Connect**. The key is stored in `localStorage` — it never leaves your browser and is not sent to any third-party server.

To disconnect / swap keys, click **Disconnect** in the top-right corner.

---

## User flow

| Step | What you see |
|------|-------------|
| 1 | List of your **Teams** |
| 2 | Select a team → list of **Projects** |
| 3 | Select a project → list of **Milestones** |
| 4 | Select a milestone → **Gantt chart** |

Breadcrumbs at the top let you step back up at any time.

---

## Gantt chart details

- **One row per issue**, time on the X-axis (days).
- **Color coding**: green = completed, amber = in-progress, blue = unstarted/backlog, muted = canceled.
- **Real vs computed bars**: issues with `startedAt`/`completedAt` use real timestamps; issues without dates are scheduled via ASAP topological sort over the dependency graph.
- **Dependency arrows**: drawn from each blocker's bar to the bar it blocks (finish-to-start), based on Linear's `blocks` relations.
- **Hover** a bar to see identifier, title, state, assignee, estimate, and dates.
- **Click** a bar or label to open the issue in Linear.
- **Today** is marked with a red dashed line; weekends are shaded.

---

## Notes

- Linear's GraphQL API sends permissive CORS headers, so direct browser requests work fine with a personal API key.
- The key is stored only in `localStorage` under the key `lgk`. Clear it with `localStorage.removeItem('lgk')` or use the Disconnect button.