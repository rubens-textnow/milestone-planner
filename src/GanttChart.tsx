import { useState, useRef, useCallback, useEffect } from 'react'
import type { Issue } from './types'
import { buildSchedule, stateColors, sod, addD, isWE, MS } from './schedule'
import { gql, M_CREATE_RELATION, M_DELETE_RELATION } from './api'
import IssueDetail from './IssueDetail'

const ROW_H = 36
const DAY_W = 26
const HDR_H = 46
const MIN_LBL_W = 120
const DEFAULT_LBL_W = 264
const BAR_PAD = 5
const HANDLE_W = 8
const POINT_W = 52   // pixels per story point

function rowHeight(_estimate: number | null): number {
  return ROW_H
}

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

interface DragState {
  fromIden: string
  side: 'left' | 'right'
  mx: number
  my: number
}

interface ArrowMeta {
  ax1: number; ay1: number
  ax2: number; ay2: number
  ctrl: number
  relationId: string
  blockerIden: string
  blockedIden: string
}

const fmt = (d: Date | null) =>
  d ? d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

interface Props {
  issues: Issue[]
  apiKey: string
  onRefresh: () => void
}

export default function GanttChart({ issues, apiKey, onRefresh }: Props) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoveredArrow, setHoveredArrow] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ relationId: string; x: number; y: number } | null>(null)
  const [working, setWorking] = useState(false)
  const [lblW, setLblW] = useState(DEFAULT_LBL_W)
  const resizingRef = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)
  const svgRef = useRef<SVGSVGElement>(null)

  // Column resize — attach global listeners so dragging outside the handle still works
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    resizeStartX.current = e.clientX
    resizeStartW.current = lblW

    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return
      const next = Math.max(MIN_LBL_W, resizeStartW.current + ev.clientX - resizeStartX.current)
      setLblW(next)
    }
    function onUp() {
      resizingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [lblW])

  // Clean up if component unmounts mid-drag
  useEffect(() => () => { resizingRef.current = false }, [])

  if (!issues.length) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>
      This milestone has no issues.
    </div>
  )

  const { sched, topo, outgoing, cycleWarnings } = buildSchedule(issues)
  const byIden = Object.fromEntries(issues.map(i => [i.identifier, i]))
  const byId = Object.fromEntries(issues.map(i => [i.id, i]))

  const selectedIssue = selectedId ? issues.find(i => i.identifier === selectedId) ?? null : null

  const blockedByMap: Record<string, Issue[]> = {}
  const blocksMap: Record<string, Issue[]> = {}
  for (const iss of issues) { blockedByMap[iss.identifier] = []; blocksMap[iss.identifier] = [] }
  for (const iss of issues) {
    for (const r of iss.relations?.nodes ?? []) {
      if (r.type === 'blocks' && byId[r.relatedIssue.id]) {
        blocksMap[iss.identifier].push(byId[r.relatedIssue.id])
        blockedByMap[r.relatedIssue.identifier]?.push(iss)
      }
    }
  }

  const relationLookup: Record<string, string> = {}
  for (const iss of issues) {
    for (const r of iss.relations?.nodes ?? []) {
      if (r.type === 'blocks') relationLookup[`${iss.identifier}→${r.relatedIssue.identifier}`] = r.id
    }
  }

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

  // Cumulative row offsets — each row height depends on estimate size
  const rowY: Record<string, number> = {}
  const rowH: Record<string, number> = {}
  let cursor = HDR_H
  for (const id of topo) {
    const iss = byIden[id]
    const h = rowHeight(iss?.estimate ?? null)
    rowY[id] = cursor
    rowH[id] = h
    cursor += h
  }
  const svgH = cursor

  const dx = (d: Date) => Math.floor((sod(d).getTime() - minD!.getTime()) / MS) * DAY_W
  const ry = (id: string) => rowY[id] ?? HDR_H

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
    const pts = Math.max(1, Math.round(iss.estimate ?? 1))
    const w = pts * POINT_W
    const y = ry(id)
    return [{ id, iss, x, w, y, s, c: stateColors(iss.state?.type) }]
  })
  const barByIden = Object.fromEntries(bars.map(b => [b.id, b]))

  const arrows: ArrowMeta[] = []
  for (const [fromId, toSet] of Object.entries(outgoing)) {
    const fs = sched[fromId]
    if (!fs || rowY[fromId] === undefined) continue
    const ax1 = dx(fs.end) + DAY_W - 1
    const ay1 = ry(fromId) + rowH[fromId] / 2
    for (const toId of toSet) {
      const ts = sched[toId]
      if (!ts || rowY[toId] === undefined) continue
      const ax2 = dx(ts.start)
      const ay2 = ry(toId) + rowH[toId] / 2
      const ctrl = Math.max(40, Math.abs(ax2 - ax1) / 2)
      const relationId = relationLookup[`${fromId}→${toId}`] ?? ''
      arrows.push({ ax1, ay1, ax2, ay2, ctrl, relationId, blockerIden: fromId, blockedIden: toId })
    }
  }

  function handleSelect(identifier: string) {
    if (drag) return
    setTip(null)
    setSelectedId(prev => prev === identifier ? null : identifier)
  }

  function svgPoint(e: React.MouseEvent): { x: number; y: number } | null {
    if (!svgRef.current) return null
    const rect = svgRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function barAtPoint(x: number, y: number): Bar | null {
    for (const b of bars) {
      const h = rowH[b.id]
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + h) return b
    }
    return null
  }

  const onMouseMoveSvg = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return
    setDrag(prev => prev ? { ...prev, mx: e.clientX, my: e.clientY } : null)
  }, [drag])

  const onMouseUpSvg = useCallback(async (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return
    const pt = svgPoint(e)
    const target = pt ? barAtPoint(pt.x, pt.y) : null

    if (target && target.id !== drag.fromIden) {
      const blocker = drag.side === 'right' ? drag.fromIden : target.id
      const blocked = drag.side === 'right' ? target.id : drag.fromIden

      if (!relationLookup[`${blocker}→${blocked}`]) {
        const blockerIssue = byIden[blocker]
        const blockedIssue = byIden[blocked]
        if (blockerIssue && blockedIssue) {
          setWorking(true)
          try {
            await gql(apiKey, M_CREATE_RELATION, {
              issueId: blockerIssue.id,
              relatedIssueId: blockedIssue.id,
              type: 'blocks',
            })
            onRefresh()
          } catch (err) {
            console.error(err)
          } finally {
            setWorking(false)
          }
        }
      }
    }

    setDrag(null)
  }, [drag, bars, byIden, apiKey, onRefresh, relationLookup])

  async function deleteRelation(relationId: string) {
    if (!relationId || working) return
    setConfirmDelete(null)
    setWorking(true)
    try {
      await gql(apiKey, M_DELETE_RELATION, { id: relationId })
      onRefresh()
    } catch (err) {
      console.error(err)
    } finally {
      setWorking(false)
    }
  }

  let previewLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (drag && svgRef.current) {
    const rect = svgRef.current.getBoundingClientRect()
    const srcBar = barByIden[drag.fromIden]
    if (srcBar) {
      const x1 = drag.side === 'right' ? srcBar.x + srcBar.w : srcBar.x
      const y1 = srcBar.y + (rowH[srcBar.id] ?? ROW_H_SM) / 2
      previewLine = { x1, y1, x2: drag.mx - rect.left, y2: drag.my - rect.top }
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {(cycleWarnings.length > 0 || working) && (
          <div className="cycle-warn" style={working ? { background: '#1a1535', borderColor: '#4c1d95', color: '#c4b5fd' } : {}}>
            {working ? 'Saving…' : `⚠ Dependency cycle(s) detected — schedule approximated. ${cycleWarnings.join(' | ')}`}
          </div>
        )}
        <div className="gantt-wrap">
          <div className="gantt-inner">
            {/* Sticky labels column */}
            <div className="gantt-labels" style={{ width: lblW }}>
              <div className="gantt-label-header" style={{ height: HDR_H }}>Issue</div>
              {topo.map(id => {
                const iss = byIden[id]
                if (!iss) return null
                const c = stateColors(iss.state?.type)
                const isSelected = selectedId === iss.identifier
                return (
                  <div
                    key={id}
                    className={`gantt-label-row ${isSelected ? 'gantt-label-row-sel' : ''}`}
                    style={{ height: rowH[id] }}
                    onClick={() => handleSelect(iss.identifier)}
                    title={iss.title}
                  >
                    <span className="gantt-label-id" style={{ color: c.text }}>{iss.identifier}</span>
                    <span className="gantt-label-title">{iss.title}</span>
                  </div>
                )
              })}

              {/* Resize handle */}
              <div className="gantt-col-resize" onMouseDown={onResizeMouseDown} />
            </div>

            {/* SVG chart */}
            <svg
              ref={svgRef}
              width={svgW} height={svgH}
              style={{ display: 'block', flexShrink: 0, cursor: drag ? 'crosshair' : 'default' }}
              onMouseMove={onMouseMoveSvg}
              onMouseUp={onMouseUpSvg}
              onMouseLeave={() => { if (drag) setDrag(null) }}
            >
              <defs>
                <marker id="ah" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
                  <polygon points="0 0,7 2.5,0 5" fill="#7c3aed" opacity="0.75" />
                </marker>
                <marker id="ah-del" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
                  <polygon points="0 0,7 2.5,0 5" fill="#ef4444" opacity="0.9" />
                </marker>
                <marker id="ah-preview" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
                  <polygon points="0 0,7 2.5,0 5" fill="#a78bfa" />
                </marker>
              </defs>

              {weekendXs.map(x => (
                <rect key={x} x={x} y={0} width={DAY_W} height={svgH} fill="#070712" />
              ))}

              {topo.map(id => (
                <rect
                  key={id}
                  x={0} y={ry(id)} width={svgW} height={rowH[id]}
                  fill={selectedId === id ? 'rgba(124,58,237,0.07)' : 'transparent'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSelect(id)}
                />
              ))}

              {topo.map(id => (
                <line key={id} x1={0} y1={ry(id)} x2={svgW} y2={ry(id)} stroke="#111120" />
              ))}
              <line x1={0} y1={svgH} x2={svgW} y2={svgH} stroke="#111120" />

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

              {arrows.map((a, i) => {
                const isHov = hoveredArrow === a.relationId
                const isConfirming = confirmDelete?.relationId === a.relationId
                const d = `M ${a.ax1},${a.ay1} C ${a.ax1 + a.ctrl},${a.ay1} ${a.ax2 - a.ctrl},${a.ay2} ${a.ax2},${a.ay2}`
                const active = isHov || isConfirming
                return (
                  <g key={i} style={{ cursor: a.relationId ? 'pointer' : 'default' }}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12}
                      onMouseEnter={() => setHoveredArrow(a.relationId)}
                      onMouseLeave={() => setHoveredArrow(null)}
                      onClick={e => {
                        if (!a.relationId) return
                        const svgRect = svgRef.current!.getBoundingClientRect()
                        const mx = (a.ax1 + a.ax2) / 2
                        const my = (a.ay1 + a.ay2) / 2
                        setConfirmDelete({ relationId: a.relationId, x: svgRect.left + mx, y: svgRect.top + my })
                        setHoveredArrow(null)
                      }}
                    />
                    <path
                      d={d} fill="none"
                      stroke={active ? '#ef4444' : '#7c3aed'}
                      strokeWidth={active ? 2 : 1.5}
                      opacity={active ? 0.9 : 0.55}
                      markerEnd={active ? 'url(#ah-del)' : 'url(#ah)'}
                      style={{ pointerEvents: 'none' }}
                    />
                    {isHov && !isConfirming && (
                      <text
                        x={(a.ax1 + a.ax2) / 2} y={(a.ay1 + a.ay2) / 2 - 6}
                        fill="#ef4444" fontSize={9.5} fontFamily="-apple-system,sans-serif"
                        textAnchor="middle" style={{ pointerEvents: 'none' }}
                      >
                        click to remove
                      </text>
                    )}
                  </g>
                )
              })}

              {bars.map(b => {
                const isSelected = selectedId === b.id
                const rh = rowH[b.id]
                const barH = rh - BAR_PAD * 2
                return (
                  <g key={b.id}>
                    <g
                      style={{ cursor: 'pointer' }}
                      onMouseMove={e => { if (!drag) setTip({ b, mx: e.clientX, my: e.clientY }) }}
                      onMouseLeave={() => setTip(null)}
                      onClick={() => handleSelect(b.iss.identifier)}
                    >
                      <rect
                        x={b.x + 1} y={b.y + BAR_PAD} width={b.w} height={barH}
                        rx={3} fill={b.c.fill} stroke={b.c.stroke} strokeWidth={isSelected ? 2 : 1}
                        opacity={isSelected ? 1 : 0.85}
                      />
                      {b.w > 28 && (
                        <clipPath id={`cp-${b.id}`}>
                          <rect x={b.x + 1} y={b.y + BAR_PAD} width={b.w} height={barH} />
                        </clipPath>
                      )}
                      {b.w > 28 && (
                        <text
                          x={b.x + 6} y={b.y + rh / 2 + 4}
                          fill={b.c.text} fontSize={10.5} fontFamily="-apple-system,sans-serif"
                          clipPath={`url(#cp-${b.id})`}
                        >
                          {b.iss.identifier}
                        </text>
                      )}
                    </g>

                    <rect
                      x={b.x + b.w - HANDLE_W + 2} y={b.y + BAR_PAD}
                      width={HANDLE_W} height={barH}
                      rx={3} fill="#7c3aed" opacity={drag?.fromIden === b.id && drag.side === 'right' ? 0.9 : 0}
                      style={{ cursor: 'crosshair' }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '0.5'; setTip(null) }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = drag?.fromIden === b.id ? '0.9' : '0' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        setDrag({ fromIden: b.id, side: 'right', mx: e.clientX, my: e.clientY })
                        setTip(null)
                      }}
                    />

                    <rect
                      x={b.x + 1} y={b.y + BAR_PAD}
                      width={HANDLE_W} height={barH}
                      rx={3} fill="#7c3aed" opacity={drag?.fromIden === b.id && drag.side === 'left' ? 0.9 : 0}
                      style={{ cursor: 'crosshair' }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '0.5'; setTip(null) }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = drag?.fromIden === b.id ? '0.9' : '0' }}
                      onMouseDown={e => {
                        e.stopPropagation()
                        setDrag({ fromIden: b.id, side: 'left', mx: e.clientX, my: e.clientY })
                        setTip(null)
                      }}
                    />
                  </g>
                )
              })}

              {previewLine && (
                <line
                  x1={previewLine.x1} y1={previewLine.y1}
                  x2={previewLine.x2} y2={previewLine.y2}
                  stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="5 3"
                  markerEnd="url(#ah-preview)"
                  style={{ pointerEvents: 'none' }}
                />
              )}
            </svg>
          </div>
        </div>

        {tip && !selectedIssue && !drag && (() => {
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

      {confirmDelete && (
        <div
          className="relation-confirm"
          style={{ left: confirmDelete.x, top: confirmDelete.y }}
        >
          <span>Remove this dependency?</span>
          <button className="relation-confirm-yes" onClick={() => deleteRelation(confirmDelete.relationId)}>Remove</button>
          <button className="relation-confirm-no" onClick={() => setConfirmDelete(null)}>Cancel</button>
        </div>
      )}

      {selectedIssue && sched[selectedIssue.identifier] && (
        <IssueDetail
          issue={selectedIssue}
          sched={sched[selectedIssue.identifier]}
          blockedBy={blockedByMap[selectedIssue.identifier] ?? []}
          blocks={blocksMap[selectedIssue.identifier] ?? []}
          onClose={() => setSelectedId(null)}
          onSelect={iss => setSelectedId(iss.identifier)}
        />
      )}
    </div>
  )
}
