import { useState, useEffect } from 'react'
import type { Team, Project, Milestone, Issue } from './types'
import { gql, Q_TEAMS, Q_PROJECTS, Q_MILESTONES, Q_ISSUES } from './api'
import GanttChart from './GanttChart'

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('lgk') ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [keyErr, setKeyErr] = useState('')

  const [teams, setTeams] = useState<Team[]>([])
  const [team, setTeam] = useState<Team | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [miles, setMiles] = useState<Milestone[]>([])
  const [mile, setMile] = useState<Milestone | null>(null)
  const [issues, setIssues] = useState<Issue[] | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function load(fn: () => Promise<void>) {
    setLoading(true); setError('')
    fn().catch(e => setError((e as Error).message)).finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!apiKey) return
    load(() => gql<{ teams: { nodes: Team[] } }>(apiKey, Q_TEAMS).then(d => setTeams(d.teams.nodes)))
  }, [apiKey])

  useEffect(() => {
    if (!team) return
    setProjects([]); setProject(null); setMiles([]); setMile(null); setIssues(null)
    load(() => gql<{ team: { projects: { nodes: Project[] } } }>(apiKey, Q_PROJECTS, { id: team.id })
      .then(d => setProjects(d.team.projects.nodes)))
  }, [team])

  useEffect(() => {
    if (!project) return
    setMiles([]); setMile(null); setIssues(null)
    load(() => gql<{ project: { projectMilestones: { nodes: Milestone[] } } }>(apiKey, Q_MILESTONES, { id: project.id })
      .then(d => setMiles([...d.project.projectMilestones.nodes].sort((a, b) => a.sortOrder - b.sortOrder))))
  }, [project])

  useEffect(() => {
    if (!mile) return
    setIssues(null)
    load(() => gql<{ issues: { nodes: Issue[] } }>(apiKey, Q_ISSUES, { mid: mile.id })
      .then(d => setIssues(d.issues.nodes)))
  }, [mile])

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
    setTeams([]); setTeam(null); setProjects([]); setProject(null)
    setMiles([]); setMile(null); setIssues(null); setError('')
  }

  function navTeam() { setTeam(null); setProject(null); setMile(null); setIssues(null) }
  function navProject() { setProject(null); setMile(null); setIssues(null) }
  function navMile() { setMile(null); setIssues(null) }

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
              Create a <strong>Personal API key</strong> at<br />
              <strong>Linear → Settings → API → Personal API keys</strong>.<br />
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

  const showGantt = !!mile

  return (
    <div className="app">
      <div className="topbar">
        <span className="topbar-title">Linear Gantt</span>
        {loading && <div className="spinner" />}
        <div className="topbar-spacer" />
        <button className="btn-ghost" onClick={disconnect}>Disconnect</button>
      </div>

      <div className="breadcrumb">
        <span className={`bc-item ${!team ? 'current' : ''}`} onClick={navTeam}>Teams</span>
        {team && <><span className="bc-sep">›</span>
          <span className={`bc-item ${!project ? 'current' : ''}`} onClick={navProject}>{team.name}</span></>}
        {project && <><span className="bc-sep">›</span>
          <span className={`bc-item ${!mile ? 'current' : ''}`} onClick={navMile}>{project.name}</span></>}
        {mile && <><span className="bc-sep">›</span>
          <span className="bc-item current">{mile.name}</span></>}
      </div>

      {error && <div className="error-bar">{error}</div>}

      <div className="content">
        {!showGantt && (
          <>
            <div className="panel">
              <div className="panel-header">Teams</div>
              <div className="panel-list">
                {teams.length === 0 && !loading && <div className="panel-empty">No teams found.</div>}
                {teams.map(t => (
                  <div key={t.id} className={`panel-item ${team?.id === t.id ? 'sel' : ''}`} onClick={() => setTeam(t)}>
                    <span className="panel-item-key">{t.key}</span>{t.name}
                  </div>
                ))}
              </div>
            </div>

            {team && (
              <div className="panel">
                <div className="panel-header">Projects — {team.name}</div>
                <div className="panel-list">
                  {projects.length === 0 && !loading && <div className="panel-empty">No projects.</div>}
                  {projects.map(p => (
                    <div key={p.id} className={`panel-item ${project?.id === p.id ? 'sel' : ''}`} onClick={() => setProject(p)}>
                      {p.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {project && (
              <div className="panel">
                <div className="panel-header">Milestones — {project.name}</div>
                <div className="panel-list">
                  {miles.length === 0 && !loading && <div className="panel-empty">No milestones.</div>}
                  {miles.map(m => (
                    <div key={m.id} className={`panel-item ${mile?.id === m.id ? 'sel' : ''}`} onClick={() => setMile(m)}>
                      {m.name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="placeholder">
              {!team && 'Select a team to get started'}
              {team && !project && !loading && 'Select a project'}
              {project && !mile && !loading && 'Select a milestone to view the Gantt chart'}
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
            {issues !== null && <GanttChart issues={issues} />}
          </>
        )}
      </div>
    </div>
  )
}
