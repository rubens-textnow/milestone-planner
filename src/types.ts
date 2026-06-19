export interface Team {
  id: string
  name: string
  key: string
}

export interface Project {
  id: string
  name: string
  icon: string | null
  color: string | null
}

export interface Milestone {
  id: string
  name: string
  sortOrder: number
}

export interface IssueRelation {
  id: string
  type: string
  relatedIssue: { id: string; identifier: string }
}

export interface Issue {
  id: string
  identifier: string
  title: string
  description: string | null
  estimate: number | null
  createdAt: string | null
  startedAt: string | null
  completedAt: string | null
  dueDate: string | null
  state: { name: string; type: string } | null
  assignee: { displayName: string } | null
  relations: { nodes: IssueRelation[] }
  inverseRelations: { nodes: IssueRelation[] }
}

export interface ScheduleEntry {
  start: Date
  end: Date
  real: boolean
}

export interface Schedule {
  sched: Record<string, ScheduleEntry>
  topo: string[]
  outgoing: Record<string, Set<string>>
  cycleWarnings: string[]
}
