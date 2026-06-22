import type { Issue, Schedule, ScheduleEntry } from './types'

const MS = 86_400_000
const sod = (d: Date | string): Date => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r }
const addD = (d: Date, n: number): Date => new Date(d.getTime() + n * MS)
const isWE = (d: Date): boolean => { const w = d.getDay(); return w === 0 || w === 6 }

function addWork(d: Date, n: number): Date {
  let c = sod(d), a = 0
  while (a < n) { c = addD(c, 1); if (!isWE(c)) a++ }
  return c
}

function nextWork(d: Date): Date {
  let c = addD(sod(d), 1)
  while (isWE(c)) c = addD(c, 1)
  return c
}

function snapWork(d: Date): Date {
  let c = sod(d)
  while (isWE(c)) c = addD(c, 1)
  return c
}

export function buildSchedule(issues: Issue[]): Schedule {
  const byIden = Object.fromEntries(issues.map(i => [i.identifier, i]))

  const rawEdges: { from: string; to: string }[] = []
  for (const iss of issues) {
    for (const r of iss.relations?.nodes ?? []) {
      if (r.type === 'blocks' && byIden[r.relatedIssue.identifier]) {
        rawEdges.push({ from: iss.identifier, to: r.relatedIssue.identifier })
      }
    }
  }

  const edgeSet = new Set(rawEdges.map(e => `${e.from}→${e.to}`))
  const edges = [...edgeSet].map(k => { const [f, t] = k.split('→'); return { from: f, to: t } })

  const GRAY = 1, BLACK = 2
  const color: Record<string, number> = {}
  const backEdges = new Set<string>()

  function dfs(n: string): void {
    color[n] = GRAY
    for (const { from, to } of edges) {
      if (from !== n) continue
      if (color[to] === GRAY) { backEdges.add(`${n}→${to}`) }
      else if (!color[to]) { dfs(to) }
    }
    color[n] = BLACK
  }
  for (const iss of issues) if (!color[iss.identifier]) dfs(iss.identifier)

  const cycleWarnings: string[] = []
  for (const be of backEdges) {
    const [a, b] = be.split('→')
    cycleWarnings.push(`${a} → ${b} (back-edge removed)`)
  }

  const dagEdges = edges.filter(e => !backEdges.has(`${e.from}→${e.to}`))

  const outgoing: Record<string, Set<string>> = {}
  const incomingC: Record<string, Set<string>> = {}
  for (const iss of issues) { outgoing[iss.identifier] = new Set(); incomingC[iss.identifier] = new Set() }
  for (const { from, to } of dagEdges) {
    outgoing[from].add(to)
    incomingC[to].add(from)
  }

  const inDeg = Object.fromEntries(issues.map(i => [i.identifier, incomingC[i.identifier].size]))
  const queue = issues.filter(i => inDeg[i.identifier] === 0).map(i => i.identifier)
  const topo: string[] = []
  while (queue.length) {
    const n = queue.shift()!
    topo.push(n)
    for (const m of outgoing[n]) {
      inDeg[m]--
      if (inDeg[m] === 0) queue.push(m)
    }
  }
  for (const iss of issues) if (!topo.includes(iss.identifier)) topo.push(iss.identifier)

  const today = sod(new Date())
  const projStart = snapWork(today)
  const sched: Record<string, ScheduleEntry> = {}

  for (const id of topo) {
    const iss = byIden[id]
    if (!iss) continue
    const dur = Math.max(1, Math.round(iss.estimate ?? 1))

    if (iss.completedAt && iss.startedAt) {
      sched[id] = { start: sod(new Date(iss.startedAt)), end: sod(new Date(iss.completedAt)), real: true }
    } else if (iss.startedAt) {
      const s = sod(new Date(iss.startedAt))
      sched[id] = { start: s, end: addWork(s, dur - 1), real: true }
    } else {
      let earliest = projStart
      for (const blocker of incomingC[id]) {
        const bs = sched[blocker]
        if (bs) { const c = nextWork(bs.end); if (c > earliest) earliest = c }
      }
      const s = snapWork(earliest)
      sched[id] = { start: s, end: addWork(s, dur - 1), real: false }
    }
  }

  return { sched, topo, outgoing, cycleWarnings }
}

export function stateColors(type: string | undefined): { fill: string; stroke: string; text: string } {
  switch (type) {
    case 'completed': return { fill: '#14532d', stroke: '#22c55e', text: '#86efac' }
    case 'started':   return { fill: '#78350f', stroke: '#f59e0b', text: '#fcd34d' }
    case 'canceled':  return { fill: '#1c1c2e', stroke: '#4b5563', text: '#6b7280' }
    default:          return { fill: '#1e3a5f', stroke: '#3b82f6', text: '#93c5fd' }
  }
}

export { sod, addD, isWE, MS }
