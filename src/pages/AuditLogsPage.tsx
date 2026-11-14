import { useMemo, useState } from 'react'
import type { AuditLogEntry, OperationsState } from '../domain/model'
import { Button, Dialog, EmptyState, formatDate, Icon, Panel } from '../components/ui'

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function exportCsv(rows: AuditLogEntry[]) {
  const header = ['Event ID', 'Event type', 'Operator', 'Role', 'Target type', 'Target ID', 'Previous value', 'New value', 'Timestamp', 'Reason']
  const lines = rows.map((row) => [row.id, row.eventType, row.operator, row.operatorRole, row.targetType, row.targetId, row.previousValue, row.newValue, row.timestamp, row.reason].map(csvCell).join(','))
  const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'picdrop-hopngo-demo-audit.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function AuditLogsPage({ data }: { data: OperationsState }) {
  const [search, setSearch] = useState('')
  const [eventType, setEventType] = useState('All')
  const [operator, setOperator] = useState('All')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AuditLogEntry | null>(null)
  const pageSize = 12
  const eventTypes = [...new Set(data.auditLogs.map((event) => event.eventType))].sort()
  const operators = [...new Set(data.auditLogs.map((event) => event.operator))].sort()
  const filtered = useMemo(() => data.auditLogs.filter((event) => {
    const query = search.trim().toLowerCase()
    const eventTime = new Date(event.timestamp).getTime()
    const start = from ? new Date(`${from}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
    const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
    return (!query || [event.id, event.eventType, event.operator, event.targetId, event.previousValue, event.newValue, event.reason].join(' ').toLowerCase().includes(query))
      && (eventType === 'All' || event.eventType === eventType)
      && (operator === 'All' || event.operator === operator)
      && eventTime >= start && eventTime <= end
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [data.auditLogs, search, eventType, operator, from, to])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  return <div className="page-stack">
    <Panel className="records-panel audit-panel">
      <div className="records-topline"><div className="records-count"><strong>{filtered.length}</strong><span>audit events</span><span className="dot-separator" />Append-only demo history</div><Button size="small" onClick={() => exportCsv(filtered)} disabled={!filtered.length}><Icon name="download" size={14} />Export filtered CSV</Button></div>
      <div className="filter-toolbar audit-filters"><label className="search-control"><Icon name="search" size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search event, operator, record, or value" aria-label="Search audit log" /></label><label className="filter-control"><span>Event type</span><select value={eventType} onChange={(event) => { setEventType(event.target.value); setPage(1) }}><option>All</option>{eventTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label className="filter-control"><span>Operator</span><select value={operator} onChange={(event) => { setOperator(event.target.value); setPage(1) }}><option>All</option>{operators.map((item) => <option key={item}>{item}</option>)}</select></label><label className="filter-control filter-date"><span>From</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} /></label><label className="filter-control filter-date"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1) }} /></label></div>
      <div className="table-scroll"><table className="data-table audit-table"><thead><tr><th>Event</th><th>Operator / role</th><th>Target record</th><th>Change</th><th>Timestamp</th><th /></tr></thead><tbody>
        {visible.map((event) => <tr key={event.id}>
          <td><span className="audit-event-type"><i className={event.eventType.includes('restricted') || event.eventType.includes('suspended') || event.eventType.includes('cancelled') || event.eventType.includes('delayed') ? 'audit-icon-danger' : event.eventType.includes('assigned') ? 'audit-icon-purple' : 'audit-icon-gray'} /><span><strong>{event.eventType}</strong><small>{event.id}</small></span></span></td>
          <td><strong className="audit-operator">{event.operator}</strong><small className="cell-subtext">{event.operatorRole}</small></td>
          <td><span className="record-target-type">{event.targetType}</span><strong className="audit-target-id">{event.targetId}</strong></td>
          <td><span className="audit-change"><b>{event.previousValue}</b><Icon name="arrow" size={13} /><b>{event.newValue}</b></span></td>
          <td><strong className="window-value">{formatDate(event.timestamp)}</strong><small className="cell-subtext">{new Date(event.timestamp).toLocaleDateString()}</small></td>
          <td><Button size="small" variant="quiet" onClick={() => setSelected(event)}>Details</Button></td>
        </tr>)}
      </tbody></table>{visible.length === 0 && <EmptyState title="No audit events found" detail="Changes made in this demo are recorded here and cannot be edited or deleted from the interface." />}</div>
      <div className="table-footer"><span>Showing {filtered.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="pagination"><Button size="small" variant="quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>Page {page} of {pageCount}</span><Button size="small" variant="quiet" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </Panel>
    <div className="overview-footnote"><Icon name="lock" size={14} />Audit entries are append-only in this application. This local demo does not provide production-grade tamper resistance.</div>
    {selected && <Dialog title={selected.eventType} eyebrow="AUDIT EVENT · APPEND-ONLY" onClose={() => setSelected(null)}>
      <div className="audit-detail"><div className="audit-detail-meta"><span>Event ID<strong>{selected.id}</strong></span><span>Timestamp<strong>{formatDate(selected.timestamp)}</strong></span><span>Operator<strong>{selected.operator} · {selected.operatorRole}</strong></span><span>Target<strong>{selected.targetType} · {selected.targetId}</strong></span></div><div className="audit-value-block"><span>Previous value</span><p>{selected.previousValue}</p></div><div className="audit-value-block"><span>New value</span><p>{selected.newValue}</p></div><div className="audit-value-block"><span>Reason / note</span><p>{selected.reason}</p></div><p className="muted-copy">Historical entries cannot be edited or deleted in the admin interface.</p></div>
    </Dialog>}
  </div>
}
