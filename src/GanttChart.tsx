import { useState, useRef, useCallback, useEffect } from 'react'
import type { Issue, Cycle } from './types'
import { buildSchedule, stateColors, sod, addD, MS } from './schedule'
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
  cycles: Cycle[]
  embedded?: boolean  // when true: natural height, no sidebar, no outer flex wrapper sizing
}

export default function GanttChart({ issues, apiKey, onRefresh, cycles, embedded }: Props) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [hoveredArrow, setHoveredArrow] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ relationId: string; x: number; y: number } | null>(null)
  const [working, setWorking] = useState(false)
  const [lblW, setLblW] = useState(DEFAULT_LBL_W)
  const [ganttW, setGanttW] = useState<number | null>(null)
  const resizingRef = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)
  const ganttResizingRef = useRef(false)
  const ganttResizeStartX = useRef(0)
  const ganttResizeStartW = useRef(0)
  const ganttOuterRef = useRef<HTMLDivElement>(null)
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

  const onGanttResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    ganttResizingRef.current = true
    ganttResizeStartX.current = e.clientX
    ganttResizeStartW.current = ganttOuterRef.current?.offsetWidth ?? (ganttW ?? window.innerWidth * 0.5)

    function onMove(ev: MouseEvent) {
      if (!ganttResizingRef.current) return
      const next = Math.max(300, ganttResizeStartW.current + ev.clientX - ganttResizeStartX.current)
      setGanttW(next)
    }
    function onUp() {
      ganttResizingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [ganttW])

  // Clean up if component unmounts mid-drag
  useEffect(() => () => { resizingRef.current = false; ganttResizingRef.current = false }, [])

  if (!issues.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13, padding: '24px 0' }}>
      No issues in this milestone.
    </div>
  )

  const { sched, topo, outgoing, cycleWarnings } = buildSchedule(issues)
  const byIden = Object.fromEntries(issues.map(i => [i.identifier, i]))
  const byId = Object.fromEntries(issues.map(i => [i.id, i]))

  // Build parent→children map (only for issues in this milestone)
  const childrenOf: Record<string, string[]> = {}
  const isChild: Record<string, boolean> = {}
  const parentOf: Record<string, string> = {}
  for (const iss of issues) {
    if (iss.parent && byId[iss.parent.id]) {
      const pIden = iss.parent.identifier
      if (!childrenOf[pIden]) childrenOf[pIden] = []
      childrenOf[pIden].push(iss.identifier)
      isChild[iss.identifier] = true
      parentOf[iss.identifier] = pIden
    }
  }

  // Reorder topo: each parent is immediately followed by its children
  const orderedTopo: string[] = []
  const inserted = new Set<string>()
  for (const id of topo) {
    if (inserted.has(id)) continue
    if (!isChild[id]) {
      orderedTopo.push(id)
      inserted.add(id)
      for (const childId of childrenOf[id] ?? []) {
        if (!inserted.has(childId)) { orderedTopo.push(childId); inserted.add(childId) }
      }
    }
  }
  // catch any remaining (e.g. child whose parent isn't in this milestone)
  for (const id of topo) {
    if (!inserted.has(id)) { orderedTopo.push(id); inserted.add(id) }
  }

  const selectedIssue = selectedId ? issues.find(i => i.identifier === selectedId) ?? null : null
  const hasSidebar = !!(selectedIssue && sched[selectedIssue.identifier])

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

  const today = sod(new Date())

  const sortedCycles = [...cycles].sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  // Find current cycle index
  const currentIdx = sortedCycles.findIndex(c => {
    const cs = sod(new Date(c.startsAt)), ce = sod(new Date(c.endsAt))
    return cs <= today && today <= ce
  })
  // If no current cycle, treat the next upcoming one as "current"
  const anchorIdx = currentIdx >= 0
    ? currentIdx
    : sortedCycles.findIndex(c => sod(new Date(c.startsAt)) > today)

  // Always show: current + next cycle
  const visibleIdxSet = new Set<number>()
  if (anchorIdx >= 0) {
    visibleIdxSet.add(anchorIdx)
    if (anchorIdx + 1 < sortedCycles.length) visibleIdxSet.add(anchorIdx + 1)
  }

  // Include any cycle (past or future) that overlaps with a scheduled task
  for (let i = 0; i < sortedCycles.length; i++) {
    const cs = sod(new Date(sortedCycles[i].startsAt))
    const ce = sod(new Date(sortedCycles[i].endsAt))
    for (const s of Object.values(sched)) {
      if (s.start <= ce && s.end >= cs) { visibleIdxSet.add(i); break }
    }
  }

  // Derive chart bounds from the visible cycle set (or fallback to schedule dates)
  let minD: Date | null = null, maxD: Date | null = null

  if (visibleIdxSet.size > 0) {
    for (const i of visibleIdxSet) {
      const cs = sod(new Date(sortedCycles[i].startsAt))
      const ce = sod(new Date(sortedCycles[i].endsAt))
      if (!minD || cs < minD) minD = cs
      if (!maxD || ce > maxD) maxD = ce
    }
  } else {
    // No cycles at all — fall back to schedule extent
    for (const s of Object.values(sched)) {
      if (!minD || s.start < minD) minD = s.start
      if (!maxD || s.end > maxD) maxD = s.end
    }
    if (!minD) minD = today
    if (!maxD) maxD = addD(today, 30)
  }

  const nDays = Math.ceil((maxD!.getTime() - minD!.getTime()) / MS) + 1
  const dx = (d: Date) => Math.floor((sod(d).getTime() - minD!.getTime()) / MS) * DAY_W

  // Build visible cycle columns
  interface CycleCol { id: string; label: string; x: number; w: number; start: Date; end: Date; isCurrent: boolean }
  const cycleCols: CycleCol[] = []

  if (visibleIdxSet.size > 0) {
    for (const i of [...visibleIdxSet].sort((a, b) => a - b)) {
      const c = sortedCycles[i]
      const cs = sod(new Date(c.startsAt))
      const ce = sod(new Date(c.endsAt))
      const x = dx(cs)
      const w = Math.max(DAY_W, dx(ce) - x + DAY_W)
      const isCurrent = currentIdx === i
      const label = c.name ? c.name : `Cycle ${c.number}`
      cycleCols.push({ id: c.id, label, x, w, start: cs, end: ce, isCurrent })
    }
  } else {
    // Fallback: no cycles — month columns
    let prevM = -1
    let colStart = minD!
    for (let i = 0; i <= nDays; i++) {
      const d = addD(minD!, i)
      if (d.getMonth() !== prevM || i === nDays) {
        if (prevM !== -1) {
          const x = dx(colStart)
          const w = dx(d) - x
          if (w > 0) {
            const isCurrent = colStart <= today && today < d
            cycleCols.push({
              id: `m-${prevM}-${i}`,
              label: colStart.toLocaleDateString('en', { month: 'short', year: 'numeric' }),
              x, w, start: colStart, end: d, isCurrent,
            })
          }
        }
        colStart = d
        prevM = d.getMonth()
      }
    }
  }

  // Cumulative row offsets
  const rowY: Record<string, number> = {}
  const rowH: Record<string, number> = {}
  let cursor = HDR_H
  for (const id of orderedTopo) {
    const iss = byIden[id]
    const h = rowHeight(iss?.estimate ?? null)
    rowY[id] = cursor
    rowH[id] = h
    cursor += h
  }
  const svgH = cursor

  const ry = (id: string) => rowY[id] ?? HDR_H

  const todayX = dx(today)

  const bars: Bar[] = orderedTopo.flatMap(id => {
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

  // SVG must be wide enough for both the date range and all bar right edges
  const maxBarRight = bars.reduce((m, b) => Math.max(m, b.x + b.w), 0)
  const svgW = Math.max(nDays * DAY_W, maxBarRight + DAY_W)

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
      const y1 = srcBar.y + (rowH[srcBar.id] ?? ROW_H) / 2
      previewLine = { x1, y1, x2: drag.mx - rect.left, y2: drag.my - rect.top }
    }
  }

  return (
    <div style={embedded ? { display: 'flex', minWidth: 0 } : { flex: 1, display: 'flex', minWidth: 0, overflow: 'hidden' }}>
      <div
        ref={ganttOuterRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: embedded ? 'visible' : 'hidden',
          flexShrink: embedded ? 1 : 0,
          width: embedded ? '100%' : (ganttW != null ? ganttW : hasSidebar ? '60%' : '100%'),
          minWidth: embedded ? 0 : '50vw',
        }}
      >
        {(cycleWarnings.length > 0 || working) && (
          <div className="cycle-warn" style={working ? { background: '#1a1535', borderColor: '#4c1d95', color: '#c4b5fd' } : {}}>
            {working ? 'Saving…' : `⚠ Dependency cycle(s) detected — schedule approximated. ${cycleWarnings.join(' | ')}`}
          </div>
        )}
        <div className={embedded ? 'gantt-wrap-embedded' : 'gantt-wrap'}>
          <div className="gantt-inner">
            {/* Sticky labels column */}
            <div className="gantt-labels" style={{ width: lblW, position: 'relative' }}>
              <div className="gantt-label-header" style={{ height: HDR_H }}>Issue</div>
              {orderedTopo.map(id => {
                const iss = byIden[id]
                if (!iss) return null
                const c = stateColors(iss.state?.type)
                const isSelected = selectedId === iss.identifier
                const child = !!isChild[id]
                const h = rowH[id]
                const STUB = 22
                return (
                  <div
                    key={id}
                    className={`gantt-label-row ${isSelected ? 'gantt-label-row-sel' : ''}`}
                    style={{ height: h, paddingLeft: child ? STUB + 6 : undefined, opacity: child ? 0.85 : 1, background: child ? 'rgba(255,255,255,0.025)' : undefined }}
                    onClick={() => handleSelect(iss.identifier)}
                    title={iss.title}
                  >
                    <span className="gantt-label-id" style={{ color: c.text }}>{iss.identifier}</span>
                    <span className="gantt-label-title">{iss.title}</span>
                  </div>
                )
              })}

              {/* Tree connector overlay — one SVG spanning the full label column height */}
              {(() => {
                const TX = 12, STUB = 22
                const lines: React.ReactNode[] = []
                for (const id of orderedTopo) {
                  const children = childrenOf[id]
                  if (children?.length) {
                    // vertical guide from bottom of parent row down to midpoint of last child
                    const lastChildId = children[children.length - 1]
                    const parentBottom = rowY[id] - HDR_H + rowH[id]
                    const lastChildMid = rowY[lastChildId] != null
                      ? rowY[lastChildId] - HDR_H + rowH[lastChildId] / 2
                      : parentBottom
                    lines.push(
                      <line key={`tp-${id}`} x1={TX} y1={parentBottom} x2={TX} y2={lastChildMid}
                        stroke="#ffffff" strokeWidth={1} strokeOpacity={0.08} />
                    )
                  }
                  if (isChild[id]) {
                    const siblings = childrenOf[parentOf[id]] ?? []
                    const isLast = siblings[siblings.length - 1] === id
                    const y = rowY[id] - HDR_H
                    const h = rowH[id]
                    lines.push(
                      <g key={`tc-${id}`}>
                        <line x1={TX} y1={y} x2={TX} y2={isLast ? y + h / 2 : y + h} stroke="#ffffff" strokeWidth={1} strokeOpacity={0.08} />
                        <line x1={TX} y1={y + h / 2} x2={STUB} y2={y + h / 2} stroke="#ffffff" strokeWidth={1} strokeOpacity={0.08} />
                      </g>
                    )
                  }
                }
                const totalH = svgH - HDR_H
                return (
                  <svg width={STUB} height={totalH}
                    style={{ position: 'absolute', left: 0, top: HDR_H, pointerEvents: 'none' }}>
                    {lines}
                  </svg>
                )
              })()}

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

              {/* Cycle column backgrounds */}
              {cycleCols.map(col => (
                <rect key={col.id} x={col.x} y={HDR_H} width={col.w} height={svgH - HDR_H}
                  fill={col.isCurrent ? 'rgba(124,58,237,0.06)' : 'transparent'} />
              ))}

              {orderedTopo.map(id => (
                <rect
                  key={id}
                  x={0} y={ry(id)} width={svgW} height={rowH[id]}
                  fill={selectedId === id ? 'rgba(124,58,237,0.07)' : isChild[id] ? 'rgba(255,255,255,0.025)' : 'transparent'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSelect(id)}
                />
              ))}

              {orderedTopo.map(id => (
                <line key={id} x1={0} y1={ry(id)} x2={svgW} y2={ry(id)} stroke="#111120" />
              ))}
              <line x1={0} y1={svgH} x2={svgW} y2={svgH} stroke="#111120" />

              {/* Tree connector lines in SVG — mirror the label column guides */}
              {orderedTopo.map(id => {
                const TX = 12, STUB = 22
                const children = childrenOf[id]
                if (children?.length) {
                  // parent: vertical guide from bottom of parent row to midpoint of last child row
                  const lastChildId = children[children.length - 1]
                  const parentY = ry(id) + rowH[id]
                  const lastChildMid = rowY[lastChildId] != null ? rowY[lastChildId] + rowH[lastChildId] / 2 : parentY
                  return (
                    <line key={`tree-p-${id}`} x1={TX} y1={parentY} x2={TX} y2={lastChildMid}
                      stroke="#ffffff" strokeWidth={1} strokeOpacity={0.08} style={{ pointerEvents: 'none' }} />
                  )
                }
                if (!isChild[id]) return null
                const siblings = childrenOf[parentOf[id]] ?? []
                const isLast = siblings[siblings.length - 1] === id
                const y = ry(id)
                const h = rowH[id]
                return (
                  <g key={`tree-${id}`} style={{ pointerEvents: 'none' }}>
                    <line x1={TX} y1={y} x2={TX} y2={isLast ? y + h / 2 : y + h} stroke="#ffffff" strokeWidth={1} strokeOpacity={0.08} />
                    <line x1={TX} y1={y + h / 2} x2={STUB} y2={y + h / 2} stroke="#ffffff" strokeWidth={1} strokeOpacity={0.08} />
                  </g>
                )
              })}

              <rect x={0} y={0} width={svgW} height={HDR_H} fill="#10101c" />
              <line x1={0} y1={HDR_H} x2={svgW} y2={HDR_H} stroke="#1e1e30" />

              {/* Cycle column headers */}
              {cycleCols.map(col => {
                const dateFmt = (d: Date) => d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
                return (
                  <g key={col.id}>
                    <line x1={col.x} y1={0} x2={col.x} y2={svgH} stroke="#1e1e30" />
                    <clipPath id={`hdr-${col.id}`}>
                      <rect x={col.x} y={0} width={col.w - 2} height={HDR_H} />
                    </clipPath>
                    <text x={col.x + 6} y={17} fill={col.isCurrent ? '#a78bfa' : '#4b5563'}
                      fontSize={11} fontWeight={col.isCurrent ? '600' : '400'}
                      fontFamily="-apple-system,sans-serif" clipPath={`url(#hdr-${col.id})`}>
                      {col.label}
                    </text>
                    <text x={col.x + 6} y={34} fill="#374151" fontSize={10}
                      fontFamily="-apple-system,sans-serif" clipPath={`url(#hdr-${col.id})`}>
                      {dateFmt(col.start)} – {dateFmt(col.end)}
                    </text>
                  </g>
                )
              })}

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
                      onClick={_e => {
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
                const child = !!isChild[b.id]
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
                        strokeDasharray={child ? '4 3' : undefined}
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

      {!embedded && hasSidebar && (
        <div
          style={{
            width: 5,
            flexShrink: 0,
            cursor: 'col-resize',
            background: 'transparent',
            borderLeft: '1px solid #1e1e30',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#7c3aed' }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
          onMouseDown={onGanttResizeMouseDown}
        />
      )}

      {!embedded && selectedIssue && sched[selectedIssue.identifier] && (
        <IssueDetail
          issue={selectedIssue}
          sched={sched[selectedIssue.identifier]}
          blockedBy={blockedByMap[selectedIssue.identifier] ?? []}
          blocks={blocksMap[selectedIssue.identifier] ?? []}
          onClose={() => { setSelectedId(null); setGanttW(null) }}
          onSelect={iss => setSelectedId(iss.identifier)}
        />
      )}
    </div>
  )
}
