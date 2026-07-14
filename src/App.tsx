import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Team, Project, Milestone, Issue, Cycle } from './types'
import { gql, Q_TEAMS, Q_PROJECTS, Q_MILESTONES, Q_ISSUES, Q_ISSUES_NO_MILESTONE, Q_CYCLES } from './api'
import { buildSchedule } from './schedule'
import GanttChart from './GanttChart'
import IssueDetail from './IssueDetail'

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  planned: 'Planned',
  inProgress: 'In Progress',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('lgk') ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [keyErr, setKeyErr] = useState('')

  const [teams, setTeams] = useState<Team[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [miles, setMiles] = useState<Milestone[]>([])
  const [milestoneIssues, setMilestoneIssues] = useState<Record<string, Issue[]>>({})
  const [milestoneLoading, setMilestoneLoading] = useState<Record<string, boolean>>({})
  const [collapsedMiles, setCollapsedMiles] = useState<Set<string>>(new Set())
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [unmilestoned, setUnmilestoned] = useState<Issue[]>([])
  const [unmilestoneLoading, setUnmilestoneLoading] = useState(false)
  const [unmilestoneCollapsed, setUnmilestoneCollapsed] = useState(false)
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)

  const [teamSearch, setTeamSearch] = useState('')
  const [projectStatusFilter, setProjectStatusFilter] = useState<Set<string>>(new Set())
  const [favoriteTeamIds, setFavoriteTeamIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('lgk-fav-teams') ?? '[]')) } catch { return new Set() }
  })
  const [favoriteProjectIds, setFavoriteProjectIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('lgk-fav-projects') ?? '[]')) } catch { return new Set() }
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [searchParams, setSearchParams] = useSearchParams()
  const teamId = searchParams.get('team')
  const projectId = searchParams.get('project')

  const team = teams.find(t => t.id === teamId) ?? null
  const project = projects.find(p => p.id === projectId) ?? null

  function load(fn: () => Promise<void>) {
    setLoading(true); setError('')
    fn().catch(e => setError((e as Error).message)).finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!apiKey) return
    load(() => gql<{ teams: { nodes: Team[] } }>(apiKey, Q_TEAMS).then(d => setTeams(d.teams.nodes)))
  }, [apiKey])

  useEffect(() => {
    if (!teamId || !apiKey) { setProjects([]); setCycles([]); return }
    setProjectStatusFilter(new Set())
    setProjects([])
    load(() => gql<{ team: { projects: { nodes: Project[] } } }>(apiKey, Q_PROJECTS, { id: teamId })
      .then(d => setProjects(d.team.projects.nodes)))
    gql<{ team: { cycles: { nodes: Cycle[] } } }>(apiKey, Q_CYCLES, { teamId })
      .then(d => setCycles([...d.team.cycles.nodes].sort((a, b) => a.startsAt.localeCompare(b.startsAt))))
      .catch(e => setError((e as Error).message))
  }, [teamId, apiKey])

  useEffect(() => {
    if (!projectId || !apiKey) { setMiles([]); setMilestoneIssues({}); setUnmilestoned([]); return }
    setMiles([])
    setMilestoneIssues({})
    setCollapsedMiles(new Set())
    setUnmilestoned([])
    setUnmilestoneCollapsed(false)
    setSelectedIssueId(null)
    load(() => gql<{ project: { projectMilestones: { nodes: Milestone[] } } }>(apiKey, Q_MILESTONES, { id: projectId })
      .then(d => {
        const sorted = [...d.project.projectMilestones.nodes].sort((a, b) => a.sortOrder - b.sortOrder)
        setMiles(sorted)
        sorted.forEach(m => fetchMilestoneIssues(m.id))
      }))
    setUnmilestoneLoading(true)
    gql<{ issues: { nodes: Issue[] } }>(apiKey, Q_ISSUES_NO_MILESTONE, { pid: projectId })
      .then(d => setUnmilestoned(d.issues.nodes))
      .catch(e => setError((e as Error).message))
      .finally(() => setUnmilestoneLoading(false))
  }, [projectId, apiKey])

  function fetchMilestoneIssues(mid: string) {
    setMilestoneLoading(prev => ({ ...prev, [mid]: true }))
    gql<{ issues: { nodes: Issue[] } }>(apiKey, Q_ISSUES, { mid })
      .then(d => setMilestoneIssues(prev => ({ ...prev, [mid]: d.issues.nodes })))
      .catch(e => setError((e as Error).message))
      .finally(() => setMilestoneLoading(prev => ({ ...prev, [mid]: false })))
  }

  function refreshMilestone(mid: string) {
    fetchMilestoneIssues(mid)
  }

  function connectKey() {
    const k = keyDraft.trim()
    if (!k) return
    setKeyErr('')
    setLoading(true)
    gql<{ teams: { nodes: Team[] } }>(k, Q_TEAMS)
      .then(d => {
        localStorage.setItem('lgk', k)
        setApiKey(k)
        setTeams(d.teams.nodes)
      })
      .catch(e => setKeyErr((e as Error).message))
      .finally(() => setLoading(false))
  }

  function disconnect() {
    localStorage.removeItem('lgk')
    setApiKey(''); setKeyDraft('')
    setTeams([]); setProjects([]); setMiles([]); setMilestoneIssues({}); setUnmilestoned([]); setError('')
    setSearchParams({})
  }

  function toggleFavorite(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setFavoriteTeamIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      localStorage.setItem('lgk-fav-teams', JSON.stringify([...next]))
      return next
    })
  }

  function toggleFavoriteProject(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setFavoriteProjectIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      localStorage.setItem('lgk-fav-projects', JSON.stringify([...next]))
      return next
    })
  }

  function selectTeam(t: Team) {
    setSearchParams({ team: t.id })
  }

  function selectProject(p: Project) {
    setSearchParams({ team: teamId!, project: p.id })
  }

  function navTeam() { setSearchParams({}) }
  function navProject() { setSearchParams({ team: teamId! }) }

  function toggleCollapse(mid: string) {
    setCollapsedMiles(prev => {
      const next = new Set(prev)
      if (next.has(mid)) next.delete(mid)
      else next.add(mid)
      return next
    })
  }

  if (!apiKey) {
    return (
      <div className="app">
        <div className="topbar">
          <span className="topbar-title">Linear Gantt</span>
          {loading && <div className="spinner" />}
        </div>
        <div className="key-gate">
          <div className="key-card">
            <h2>Connect to Linear</h2>
            <p>
              Create a <strong>Personal API key</strong> at{' '}
              <a
                href="https://linear.app/textnow/settings/account/security/api-keys/new"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#818cf8' }}
              >
                Linear → Settings → API Keys → New API key
              </a>
              , then paste it below.<br />
              Your key is stored in <code style={{ fontSize: 11, color: '#818cf8' }}>localStorage</code> and never leaves your browser.
            </p>
            <input
              className="key-input"
              type="password"
              placeholder="lin_api_xxxxxxxxxxxxxxxxxxxxxxxx"
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connectKey()}
              autoFocus
            />
            <button className="btn-primary" onClick={connectKey} disabled={!keyDraft.trim() || loading}>
              {loading ? 'Connecting…' : 'Connect'}
            </button>
            {keyErr && <div className="error-bar" style={{ marginTop: 12, borderRadius: 6 }}>{keyErr}</div>}
          </div>
        </div>
      </div>
    )
  }

  const showProjectView = !!projectId

  return (
    <div className="app">
      <div className="topbar">
        <span className="topbar-title">Linear Gantt</span>
        {loading && <div className="spinner" />}
        <div className="topbar-spacer" />
        <button className="btn-ghost" onClick={disconnect}>Disconnect</button>
      </div>

      <div className="breadcrumb">
        <span className={`bc-item ${!teamId ? 'current' : ''}`} onClick={navTeam}>Teams</span>
        {team && <><span className="bc-sep">›</span>
          <span className={`bc-item ${!projectId ? 'current' : ''}`} onClick={navProject}>{team.name}</span></>}
        {project && <><span className="bc-sep">›</span>
          <span className="bc-item current">{project.name}</span></>}
      </div>

      {error && <div className="error-bar">{error}</div>}

      {!showProjectView && (
        <div className="content">
          <div className="panel">
            <div className="panel-header">Teams</div>
            <div className="panel-search">
              <input
                className="panel-search-input"
                type="text"
                placeholder="Filter teams…"
                value={teamSearch}
                onChange={e => setTeamSearch(e.target.value)}
              />
            </div>
            <div className="panel-list">
              {teams.length === 0 && !loading && <div className="panel-empty">No teams found.</div>}
              {(() => {
                const filtered = teams.filter(t =>
                  t.name.toLowerCase().includes(teamSearch.toLowerCase()) ||
                  t.key.toLowerCase().includes(teamSearch.toLowerCase())
                )
                const sorted = [...filtered].sort((a, b) =>
                  favoriteTeamIds.has(a.id) === favoriteTeamIds.has(b.id) ? 0 : favoriteTeamIds.has(a.id) ? -1 : 1
                )
                if (teams.length > 0 && teamSearch && filtered.length === 0) {
                  return <div className="panel-empty">No teams match "{teamSearch}".</div>
                }
                return sorted.map(t => (
                  <div key={t.id} className={`panel-item ${teamId === t.id ? 'sel' : ''}`} onClick={() => selectTeam(t)}>
                    <span className="panel-item-key">{t.key}</span>
                    <span style={{ flex: 1 }}>{t.name}</span>
                    <button
                      className={`fav-btn ${favoriteTeamIds.has(t.id) ? 'fav-btn-on' : ''}`}
                      onClick={e => toggleFavorite(t.id, e)}
                      title={favoriteTeamIds.has(t.id) ? 'Remove favorite' : 'Mark as favorite'}
                    >★</button>
                  </div>
                ))
              })()}
            </div>
          </div>

          {teamId && (
            <div className="panel">
              <div className="panel-header">Projects — {team?.name}</div>
              {projects.length > 0 && (() => {
                const statuses = [...new Set(projects.map(p => p.status?.type ?? 'backlog'))]
                return (
                  <div className="panel-status-filter">
                    {statuses.map(s => (
                      <button
                        key={s}
                        className={`status-chip status-chip-${s} ${projectStatusFilter.has(s) ? 'status-chip-on' : ''}`}
                        onClick={() => setProjectStatusFilter(prev => {
                          const next = new Set(prev)
                          if (next.has(s)) next.delete(s); else next.add(s)
                          return next
                        })}
                      >{STATUS_LABELS[s] ?? s}</button>
                    ))}
                  </div>
                )
              })()}
              <div className="panel-list">
                {projects.length === 0 && !loading && <div className="panel-empty">No projects.</div>}
                {[...projects]
                  .filter(p => projectStatusFilter.size === 0 || projectStatusFilter.has(p.status?.type ?? 'backlog'))
                  .sort((a, b) =>
                    favoriteProjectIds.has(a.id) === favoriteProjectIds.has(b.id) ? 0 : favoriteProjectIds.has(a.id) ? -1 : 1
                  )
                  .map(p => (
                    <div key={p.id} className={`panel-item ${projectId === p.id ? 'sel' : ''}`} onClick={() => selectProject(p)}>
                      <span className="project-icon" style={{ background: p.color ?? '#374151' }} />
                      <span style={{ flex: 1 }}>{p.name}</span>
                      <button
                        className={`fav-btn ${favoriteProjectIds.has(p.id) ? 'fav-btn-on' : ''}`}
                        onClick={e => toggleFavoriteProject(p.id, e)}
                        title={favoriteProjectIds.has(p.id) ? 'Remove favorite' : 'Mark as favorite'}
                      >★</button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="placeholder">
            {!teamId && 'Select a team to get started'}
            {teamId && !loading && 'Select a project'}
          </div>
        </div>
      )}

      {showProjectView && (() => {
        const allIssues = [...unmilestoned, ...Object.values(milestoneIssues).flat()]
        const byId = Object.fromEntries(allIssues.map(i => [i.id, i]))
        const selectedIssue = selectedIssueId ? allIssues.find(i => i.identifier === selectedIssueId) ?? null : null
        const { sched: allSched } = selectedIssue
          ? buildSchedule(allIssues.filter(i => {
              const milestoneOfSelected = miles.find(m => (milestoneIssues[m.id] ?? []).some(x => x.identifier === selectedIssueId))
              if (!milestoneOfSelected) return unmilestoned.some(x => x.id === i.id)
              return (milestoneIssues[milestoneOfSelected.id] ?? []).some(x => x.id === i.id)
            }))
          : { sched: {} }

        const blockedByMap: Record<string, Issue[]> = {}
        const blocksMap: Record<string, Issue[]> = {}
        for (const iss of allIssues) { blockedByMap[iss.identifier] = []; blocksMap[iss.identifier] = [] }
        for (const iss of allIssues) {
          for (const r of iss.relations?.nodes ?? []) {
            if (r.type === 'blocks' && byId[r.relatedIssue.id]) {
              blocksMap[iss.identifier].push(byId[r.relatedIssue.id])
              blockedByMap[r.relatedIssue.identifier]?.push(iss)
            }
          }
        }

        return (
          <div className="project-split">
            <div className="project-view">
              {!loading && miles.length === 0 && !unmilestoneLoading && unmilestoned.length === 0 && (
                <div className="placeholder" style={{ padding: '48px 0' }}>No milestones in this project</div>
              )}
              {(unmilestoneLoading || unmilestoned.length > 0) && (
                <div className="milestone-section">
                  <div className="milestone-header" onClick={() => setUnmilestoneCollapsed(v => !v)}>
                    <span className="milestone-chevron">{unmilestoneCollapsed ? '▶' : '▼'}</span>
                    <span className="milestone-name" style={{ color: '#6b7280' }}>No milestone</span>
                    {unmilestoneLoading && <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
                    {!unmilestoneLoading && (
                      <span className="milestone-count">{unmilestoned.length} issue{unmilestoned.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {!unmilestoneCollapsed && (
                    <div className="milestone-body">
                      {unmilestoneLoading && (
                        <div className="loading-row" style={{ padding: '20px 0' }}>
                          <div className="spinner" />Loading issues…
                        </div>
                      )}
                      {!unmilestoneLoading && (
                        <GanttChart
                          issues={unmilestoned}
                          apiKey={apiKey}
                          onRefresh={() => {
                            setUnmilestoneLoading(true)
                            gql<{ issues: { nodes: Issue[] } }>(apiKey, Q_ISSUES_NO_MILESTONE, { pid: projectId! })
                              .then(d => setUnmilestoned(d.issues.nodes))
                              .catch(e => setError((e as Error).message))
                              .finally(() => setUnmilestoneLoading(false))
                          }}
                          cycles={cycles}
                          embedded
                          selectedId={selectedIssueId}
                          onSelectId={setSelectedIssueId}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
              {miles.map(m => {
                const issues = milestoneIssues[m.id] ?? null
                const isLoading = milestoneLoading[m.id] ?? false
                const collapsed = collapsedMiles.has(m.id)
                return (
                  <div key={m.id} className="milestone-section">
                    <div className="milestone-header" onClick={() => toggleCollapse(m.id)}>
                      <span className="milestone-chevron">{collapsed ? '▶' : '▼'}</span>
                      <span className="milestone-name">{m.name}</span>
                      {isLoading && <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />}
                      {issues !== null && !isLoading && (
                        <span className="milestone-count">{issues.length} issue{issues.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    {!collapsed && (
                      <div className="milestone-body">
                        {isLoading && (
                          <div className="loading-row" style={{ padding: '20px 0' }}>
                            <div className="spinner" />Loading issues…
                          </div>
                        )}
                        {!isLoading && issues !== null && (
                          <GanttChart
                            issues={issues}
                            apiKey={apiKey}
                            onRefresh={() => refreshMilestone(m.id)}
                            cycles={cycles}
                            embedded
                            selectedId={selectedIssueId}
                            onSelectId={setSelectedIssueId}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {selectedIssue && allSched[selectedIssue.identifier] && (
              <IssueDetail
                issue={selectedIssue}
                sched={allSched[selectedIssue.identifier]}
                blockedBy={blockedByMap[selectedIssue.identifier] ?? []}
                blocks={blocksMap[selectedIssue.identifier] ?? []}
                onClose={() => setSelectedIssueId(null)}
                onSelect={iss => setSelectedIssueId(iss.identifier)}
              />
            )}
          </div>
        )
      })()}
    </div>
  )
}
