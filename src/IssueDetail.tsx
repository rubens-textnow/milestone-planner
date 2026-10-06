import { useRef, useState, useEffect } from 'react'
import type { Issue, ScheduleEntry } from './types'
import { stateColors } from './schedule'

interface Props {
  issue: Issue
  sched: ScheduleEntry
  blockedBy: Issue[]
  blocks: Issue[]
  onClose: () => void
  onSelect: (iss: Issue) => void
}

const fmt = (d: Date | null | string) => {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d)
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

const MIN_W = 240
const MAX_W = 800
const DEFAULT_W = 400

export default function IssueDetail({ issue, sched, blockedBy, blocks, onClose, onSelect }: Props) {
  const c = stateColors(issue.state?.type)
  const [width, setWidth] = useState(DEFAULT_W)
  const startX = useRef(0)
  const startW = useRef(0)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const next = Math.max(MIN_W, Math.min(MAX_W, startW.current + startX.current - e.clientX))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startX.current = e.clientX
    startW.current = width
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_W, Math.min(MAX_W, startW.current + startX.current - ev.clientX))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="detail-panel" style={{ width }}>
      <div className="detail-resize-handle" onMouseDown={onResizeMouseDown} />
      <div className="detail-header">
        <div className="detail-identifier" style={{ color: c.text }}>{issue.identifier}</div>
        <div className="detail-actions">
          <a
            className="btn-ghost"
            href={`https://linear.app/issue/${issue.identifier}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Linear ↗
          </a>
          <button className="detail-close" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      <div className="detail-title">{issue.title}</div>
      {issue.description && (
        <div className="detail-description">{issue.description}</div>
      )}

      <div className="detail-section">
        <div className="detail-row">
          <span className="detail-lbl">State</span>
          <span className="detail-val">
            <span className="detail-state-dot" style={{ background: c.stroke }} />
            {issue.state?.name ?? '—'}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-lbl">Assignee</span>
          <span className="detail-val">{issue.assignee?.displayName ?? 'Unassigned'}</span>
        </div>
        <div className="detail-row">
          <span className="detail-lbl">Estimate</span>
          <span className="detail-val">{issue.estimate != null ? `${issue.estimate}d` : 'Not set'}</span>
        </div>
        <div className="detail-row">
          <span className="detail-lbl">Due date</span>
          <span className="detail-val">{fmt(issue.dueDate)}</span>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-title">Schedule</div>
        <div className="detail-row">
          <span className="detail-lbl">Start</span>
          <span className="detail-val">{fmt(sched.start)}{!sched.real && <span className="detail-computed"> · computed</span>}</span>
        </div>
        <div className="detail-row">
          <span className="detail-lbl">End</span>
          <span className="detail-val">{fmt(sched.end)}{!sched.real && <span className="detail-computed"> · computed</span>}</span>
        </div>
      </div>

      {blockedBy.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Blocked by</div>
          {blockedBy.map(iss => {
            const rc = stateColors(iss.state?.type)
            return (
              <div key={iss.id} className="detail-dep-item" onClick={() => onSelect(iss)}>
                <span className="detail-dep-id" style={{ color: rc.text }}>{iss.identifier}</span>
                <span className="detail-dep-title">{iss.title}</span>
              </div>
            )
          })}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Blocks</div>
          {blocks.map(iss => {
            const rc = stateColors(iss.state?.type)
            return (
              <div key={iss.id} className="detail-dep-item" onClick={() => onSelect(iss)}>
                <span className="detail-dep-id" style={{ color: rc.text }}>{iss.identifier}</span>
                <span className="detail-dep-title">{iss.title}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}