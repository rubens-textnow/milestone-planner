import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Team, Project, Milestone, Issue } from './types'
import { gql, Q_TEAMS, Q_PROJECTS, Q_MILESTONES, Q_ISSUES } from './api'
import GanttChart from './GanttChart'

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('lgk') ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [keyErr, setKeyErr] = useState('')

  const [teams, setTeams] = useState<Team[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [miles, setMiles] = useState<Milestone[]>([])
  const [issues, setIssues] = useState<Issue[] | null>(null)

  const [teamSearch, setTeamSearch] = useState('')
  const [favoriteTeamId, setFavoriteTeamId] = useState<string | null>(() => localStorage.getItem('lgk-fav-team'))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [searchParams, setSearchParams] = useSearchParams()
  const teamId = searchParams.get('team')
  const projectId = searchParams.get('project')
  const milestoneId = searchParams.get('milestone')

  const team = teams.find(t => t.id === teamId) ?? null
  const project = projects.find(p => p.id === projectId) ?? null
  const mile = miles.find(m => m.id === milestoneId) ?? null

  function load(fn: () => Promise<void>) {
    setLoading(true); setError('')
    fn().catch(e => setError((e as Error).message)).finally(() => setLoading(false))
  }

  // Fetch teams on key change
  useEffect(() => {
    if (!apiKey) return
    load(() => gql<{ teams: { nodes: Team[] } }>(apiKey, Q_TEAMS).then(d => setTeams(d.teams.nodes)))
  }, [apiKey])

  // Fetch projects when teamId changes
  useEffect(() => {
    if (!teamId || !apiKey) { setProjects([]); return }
    setProjects([])
    load(() => gql<{ team: { projects: { nodes: Project[] } } }>(apiKey, Q_PROJECTS, { id: teamId })
      .then(d => setProjects(d.team.projects.nodes)))
  }, [teamId, apiKey])

  // Fetch milestones when projectId changes
  useEffect(() => {
    if (!projectId || !apiKey) { setMiles([]); return }
    setMiles([])
    load(() => gql<{ project: { projectMilestones: { nodes: Milestone[] } } }>(apiKey, Q_MILESTONES, { id: projectId })
      .then(d => setMiles([...d.project.projectMilestones.nodes].sort((a, b) => a.sortOrder - b.sortOrder))))
  }, [projectId, apiKey])

  // Fetch issues when milestoneId changes
  useEffect(() => {
    if (!milestoneId || !apiKey) { setIssues(null); return }
    setIssues(null)
    load(() => gql<{ issues: { nodes: Issue[] } }>(apiKey, Q_ISSUES, { mid: milestoneId })
      .then(d => setIssues(d.issues.nodes)))
  }, [milestoneId, apiKey])

  function refreshIssues() {
    if (!milestoneId || !apiKey) return
    gql<{ issues: { nodes: Issue[] } }>(apiKey, Q_ISSUES, { mid: milestoneId })
      .then(d => setIssues(d.issues.nodes))
      .catch(e => setError((e as Error).message))
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
    setTeams([]); setProjects([]); setMiles([]); setIssues(null); setError('')
    setSearchParams({})
  }

  function toggleFavorite(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const next = favoriteTeamId === id ? null : id
    setFavoriteTeamId(next)
    if (next) localStorage.setItem('lgk-fav-team', next)
    else localStorage.removeItem('lgk-fav-team')
  }

  function selectTeam(t: Team) {
    setSearchParams({ team: t.id })
  }

  function selectProject(p: Project) {
    setSearchParams({ team: teamId!, project: p.id })
  }

  function selectMilestone(m: Milestone) {
    setSearchParams({ team: teamId!, project: projectId!, milestone: m.id })
  }

  function navTeam() { setSearchParams({}) }
  function navProject() { setSearchParams({ team: teamId! }) }
  function navMile() { setSearchParams({ team: teamId!, project: projectId! }) }

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

  const showGantt = !!milestoneId

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
          <span className={`bc-item ${!milestoneId ? 'current' : ''}`} onClick={navMile}>{project.name}</span></>}
        {mile && <><span className="bc-sep">›</span>
          <span className="bc-item current">{mile.name}</span></>}
      </div>

      {error && <div className="error-bar">{error}</div>}

      <div className="content">
        {!showGantt && (
          <>
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
                    a.id === favoriteTeamId ? -1 : b.id === favoriteTeamId ? 1 : 0
                  )
                  if (teams.length > 0 && teamSearch && filtered.length === 0) {
                    return <div className="panel-empty">No teams match "{teamSearch}".</div>
                  }
                  return sorted.map(t => (
                    <div key={t.id} className={`panel-item ${teamId === t.id ? 'sel' : ''}`} onClick={() => selectTeam(t)}>
                      <span className="panel-item-key">{t.key}</span>
                      <span style={{ flex: 1 }}>{t.name}</span>
                      <button
                        className={`fav-btn ${favoriteTeamId === t.id ? 'fav-btn-on' : ''}`}
                        onClick={e => toggleFavorite(t.id, e)}
                        title={favoriteTeamId === t.id ? 'Remove favorite' : 'Mark as favorite'}
                      >★</button>
                    </div>
                  ))
                })()}
              </div>
            </div>

            {teamId && (
              <div className="panel">
                <div className="panel-header">Projects — {team?.name}</div>
                <div className="panel-list">
                  {projects.length === 0 && !loading && <div className="panel-empty">No projects.</div>}
                  {projects.map(p => (
                    <div key={p.id} className={`panel-item ${projectId === p.id ? 'sel' : ''}`} onClick={() => selectProject(p)}>
                      <span className="project-icon" style={{ background: p.color ?? '#374151' }} />
                      {p.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {projectId && (
              <div className="panel">
                <div className="panel-header">Milestones — {project?.name}</div>
                <div className="panel-list">
                  {miles.length === 0 && !loading && <div className="panel-empty">No milestones.</div>}
                  {miles.map(m => (
                    <div key={m.id} className={`panel-item ${milestoneId === m.id ? 'sel' : ''}`} onClick={() => selectMilestone(m)}>
                      {m.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="placeholder">
              {!teamId && 'Select a team to get started'}
              {teamId && !projectId && !loading && 'Select a project'}
              {projectId && !milestoneId && !loading && 'Select a milestone to view the Gantt chart'}
            </div>
          </>
        )}

        {showGantt && (
          <>
            {!issues && loading && (
              <div className="loading-row" style={{ flex: 1 }}>
                <div className="spinner" />Loading issues…
              </div>
            )}
            {issues !== null && <GanttChart issues={issues} apiKey={apiKey} onRefresh={refreshIssues} />}
          </>
        )}
      </div>
    </div>
  )
}
