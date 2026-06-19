const LINEAR_ENDPOINT = 'https://api.linear.app/graphql'

export async function gql<T>(key: string, query: string, vars: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(LINEAR_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: vars }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${txt ? ' — ' + txt.slice(0, 160) : ''}`)
  }
  const json = await res.json()
  if (json.errors?.length) throw new Error(json.errors[0].message)
  return json.data as T
}

export const Q_TEAMS = `query { teams(first:250){ nodes{ id name key } } }`

export const Q_PROJECTS = `query($id:String!){
  team(id:$id){ projects(first:250){ nodes{ id name icon color } } }
}`

export const Q_MILESTONES = `query($id:String!){
  project(id:$id){ projectMilestones(first:250){ nodes{ id name sortOrder } } }
}`

export const Q_ISSUES = `query($mid:ID!){
  issues(first:250, filter:{ projectMilestone:{ id:{ eq:$mid } } }){
    nodes{
      id identifier title estimate
      createdAt startedAt completedAt dueDate
      state{ name type }
      assignee{ displayName }
      relations       { nodes{ type relatedIssue{ id identifier } } }
      inverseRelations{ nodes{ type relatedIssue{ id identifier } } }
    }
  }
}`
