import { useState } from 'react'
import type { Issue } from './types'
import { buildSchedule, stateColors, sod, addD, isWE, MS } from './schedule'

const ROW_H = 36
const DAY_W = 26
const HDR_H = 46
const LBL_W = 264
const BAR_PAD = 5

interface TooltipState {
  b: Bar
  mx: number
  my: number
}

interface Bar {
  id: string
  iss: Issue
  x: number
  w: number
  y: number
  s: { start: Date; end: Date; real: boolean }
  c: { fill: string; stroke: string; text: string }
}

const fmt = (d: Date | null) =>
  d ? d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function GanttChart({ issues }: { issues: Issue[] }) {
  const [tip, setTip] = useState<TooltipState | null>(null)

  if (!issues.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>
      This milestone has no issues.
    </div>
  )

  const { sched, topo, outgoing, cycleWarnings } = buildSchedule(issues)
  const byIden = Object.fromEntries(issues.map(i => [i.identifier, i]))

  let minD: Date | null = null, maxD: Date | null = null
  for (const s of Object.values(sched)) {
    if (!minD || s.start < minD) minD = s.start
    if (!maxD || s.end > maxD) maxD = s.end
  }
  const today = sod(new Date())
  if (!minD) minD = today
  if (!maxD) maxD = addD(today, 30)
  minD = addD(minD, -3)
  maxD = addD(maxD, 7)

  const nDays = Math.ceil((maxD.getTime() - minD.getTime()) / MS) + 1
  const svgW = nDays * DAY_W
  const svgH = topo.length * ROW_H + HDR_H
  const rowIdx = Object.fromEntries(topo.map((id, i) => [id, i]))

  const dx = (d: Date) => Math.floor((sod(d).getTime() - minD!.getTime()) / MS) * DAY_W
  const ry = (i: number) => HDR_H + i * ROW_H

  const monthMarks: { x: number; label: string }[] = []
  let prevM = -1
  for (let i = 0; i < nDays; i++) {
    const d = addD(minD, i)
    if (d.getMonth() !== prevM) {
      monthMarks.push({ x: i * DAY_W, label: d.toLocaleDateString('en', { month: 'short', year: 'numeric' }) })
      prevM = d.getMonth()
    }
  }

  const weekMarks: { x: number; day: number }[] = []
  for (let i = 0; i < nDays; i++) {
    const d = addD(minD, i)
    if (d.getDay() === 1) weekMarks.push({ x: i * DAY_W, day: d.getDate() })
  }

  const weekendXs: number[] = []
  for (let i = 0; i < nDays; i++) {
    const d = addD(minD, i)
    if (isWE(d)) weekendXs.push(i * DAY_W)
  }

  const todayX = dx(today)

  const bars: Bar[] = topo.flatMap(id => {
    const iss = byIden[id]
    const s = sched[id]
    if (!iss || !s) return []
    const x = dx(s.start)
    const x2 = dx(s.end) + DAY_W - 2
    const w = Math.max(DAY_W - 2, x2 - x)
    const y = ry(rowIdx[id])
    return [{ id, iss, x, w, y, s, c: stateColors(iss.state?.type) }]
  })

  const arrows: { ax1: number; ay1: number; ax2: number; ay2: number; ctrl: number }[] = []
  for (const [fromId, toSet] of Object.entries(outgoing)) {
    const fs = sched[fromId]
    if (!fs) continue
    const fi = rowIdx[fromId]
    if (fi === undefined) continue
    const ax1 = dx(fs.end) + DAY_W - 1
    const ay1 = ry(fi) + ROW_H / 2
    for (const toId of toSet) {
      const ts = sched[toId]
      const ti = rowIdx[toId]
      if (!ts || ti === undefined) continue
      const ax2 = dx(ts.start)
      const ay2 = ry(ti) + ROW_H / 2
      const ctrl = Math.max(40, Math.abs(ax2 - ax1) / 2)
      arrows.push({ ax1, ay1, ax2, ay2, ctrl })
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {cycleWarnings.length > 0 && (
        <div className="cycle-warn">
          ⚠ Dependency cycle(s) detected — schedule approximated. {cycleWarnings.join(' | ')}
        </div>
      )}
      <div className="gantt-wrap">
        <div className="gantt-inner">
          <div className="gantt-labels" style={{ width: LBL_W }}>
            <div className="gantt-label-header" style={{ height: HDR_H }}>Issue</div>
            {topo.map(id => {
              const iss = byIden[id]
              if (!iss) return null
              const c = stateColors(iss.state?.type)
              return (
                <div
                  key={id}
                  className="gantt-label-row"
                  style={{ height: ROW_H }}
                  onClick={() => window.open(`https://linear.app/issue/${iss.identifier}`, '_blank')}
                  title={iss.title}
                >
                  <span className="gantt-label-id" style={{ color: c.text }}>{iss.identifier}</span>
                  <span className="gantt-label-title">{iss.title}</span>
                </div>
              )
            })}
          </div>

          <svg width={svgW} height={svgH} style={{ display: 'block', flexShrink: 0 }}>
            <defs>
              <marker id="ah" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
                <polygon points="0 0,7 2.5,0 5" fill="#7c3aed" opacity="0.75" />
              </marker>
            </defs>

            {weekendXs.map(x => (
              <rect key={x} x={x} y={0} width={DAY_W} height={svgH} fill="#070712" />
            ))}

            {topo.map((_, i) => (
              <line key={i} x1={0} y1={ry(i)} x2={svgW} y2={ry(i)} stroke="#111120" />
            ))}
            <line x1={0} y1={ry(topo.length)} x2={svgW} y2={ry(topo.length)} stroke="#111120" />

            <rect x={0} y={0} width={svgW} height={HDR_H} fill="#10101c" />
            <line x1={0} y1={HDR_H} x2={svgW} y2={HDR_H} stroke="#1e1e30" />

            {monthMarks.map(m => (
              <text key={m.x} x={m.x + 5} y={18} fill="#4b5563" fontSize={11} fontFamily="-apple-system,sans-serif">{m.label}</text>
            ))}

            {weekMarks.map(w => (
              <g key={w.x}>
                <line x1={w.x} y1={24} x2={w.x} y2={HDR_H} stroke="#1e1e30" />
                <text x={w.x + 3} y={40} fill="#374151" fontSize={10} fontFamily="-apple-system,sans-serif">{w.day}</text>
              </g>
            ))}

            {todayX >= 0 && todayX <= svgW && (
              <g>
                <line x1={todayX} y1={0} x2={todayX} y2={svgH} stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
                <text x={todayX + 3} y={13} fill="#ef4444" fontSize={10} fontFamily="-apple-system,sans-serif">Today</text>
              </g>
            )}

            {arrows.map((a, i) => (
              <path
                key={i}
                d={`M ${a.ax1},${a.ay1} C ${a.ax1 + a.ctrl},${a.ay1} ${a.ax2 - a.ctrl},${a.ay2} ${a.ax2},${a.ay2}`}
                fill="none" stroke="#7c3aed" strokeWidth={1.5} opacity={0.55}
                markerEnd="url(#ah)"
              />
            ))}

            {bars.map(b => (
              <g
                key={b.id}
                style={{ cursor: 'pointer' }}
                onMouseMove={e => setTip({ b, mx: e.clientX, my: e.clientY })}
                onMouseLeave={() => setTip(null)}
                onClick={() => window.open(`https://linear.app/issue/${b.iss.identifier}`, '_blank')}
              >
                <rect
                  x={b.x + 1} y={b.y + BAR_PAD} width={b.w} height={ROW_H - BAR_PAD * 2}
                  rx={3} fill={b.c.fill} stroke={b.c.stroke} strokeWidth={1}
                />
                {b.w > 28 && (
                  <clipPath id={`cp-${b.id}`}>
                    <rect x={b.x + 1} y={b.y + BAR_PAD} width={b.w} height={ROW_H - BAR_PAD * 2} />
                  </clipPath>
                )}
                {b.w > 28 && (
                  <text
                    x={b.x + 6} y={b.y + ROW_H / 2 + 4}
                    fill={b.c.text} fontSize={10.5} fontFamily="-apple-system,sans-serif"
                    clipPath={`url(#cp-${b.id})`}
                  >
                    {b.iss.identifier}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      </div>

      {tip && (() => {
        const { b, mx, my } = tip
        const { iss, s } = b
        return (
          <div className="tt" style={{ left: mx + 14, top: my - 8 }}>
            <div className="tt-name">{iss.identifier}: {iss.title}</div>
            <div className="tt-row"><span className="tt-lbl">State</span><span className="tt-val">{iss.state?.name ?? '—'}</span></div>
            <div className="tt-row"><span className="tt-lbl">Assignee</span><span className="tt-val">{iss.assignee?.displayName ?? 'Unassigned'}</span></div>
            <div className="tt-row"><span className="tt-lbl">Estimate</span><span className="tt-val">{iss.estimate != null ? `${iss.estimate}d` : 'Not set'}</span></div>
            <div className="tt-row"><span className="tt-lbl">Start</span><span className="tt-val">{fmt(s.start)}{s.real ? '' : ' ·computed'}</span></div>
            <div className="tt-row"><span className="tt-lbl">End</span><span className="tt-val">{fmt(s.end)}{s.real ? '' : ' ·computed'}</span></div>
          </div>
        )
      })()}
    </div>
  )
}
