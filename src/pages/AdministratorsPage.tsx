import { useState, type FormEvent } from 'react'
import { ADMIN_ACTION_OPTIONS, ADMIN_SECTION_OPTIONS, isMainAdministrator, sectionLabels } from '../domain/admin'
import type { AdminAccount, AdminRole, AdminSection, OperationsState, Permission } from '../domain/model'
import { Button, ConfirmDialog, Dialog, EmptyState, formatDate, Icon, initials, Panel, StatusBadge } from '../components/ui'
import { useOperations } from '../state/OperationsProvider'

function actionSummary(account: AdminAccount) {
  if (account.role === 'Main Administrator') return 'Full access'
  const actions = account.permissions.filter((permission) => permission !== 'read').length
  return actions ? `${actions} action${actions === 1 ? '' : 's'}` : 'View only'
}

function accessSummary(account: AdminAccount) {
  if (account.role === 'Main Administrator') return 'Every section and action'
  const sections = sectionLabels(account.sections)
  return sections.length ? sections.join(' · ') : 'No console sections'
}

export function AdministratorsPage({ data }: { data: OperationsState }) {
  const { frame, dispatch } = useOperations()
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; accountId: string } | null>(null)
  const [statusTarget, setStatusTarget] = useState<AdminAccount | null>(null)
  const main = isMainAdministrator(frame.data.user) && frame.data.user.provisioned

  if (!main) {
    return <div className="route-not-found"><Icon name="lock" size={22} /><h2>Main administrator access required</h2><p>Only a main administrator can review or change administrator access.</p></div>
  }

  const accounts = [...data.admins].sort((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1
    if (left.role !== right.role) return left.role === 'Main Administrator' ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  const active = accounts.filter((account) => account.active)
  const activeMains = active.filter((account) => account.role === 'Main Administrator').length
  const restricted = active.length - activeMains
  const editing = editor?.mode === 'edit' ? data.admins.find((account) => account.id === editor.accountId) : undefined
  const currentEmail = frame.data.user.email.trim().toLowerCase()

  function canChangeStatus(account: AdminAccount) {
    if (account.email === currentEmail) return false
    if (account.active && account.role === 'Main Administrator' && activeMains <= 1) return false
    return true
  }

  return <div className="page-stack">
    <div className="admin-summary-strip">
      <div><span className="summary-card-label">MAIN ADMINISTRATORS</span><strong>{activeMains} / 2</strong><small>Full access accounts</small></div>
      <div><span className="summary-card-label">RESTRICTED ADMINISTRATORS</span><strong>{restricted}</strong><small>Sections and actions selected by a main administrator</small></div>
      <div><span className="summary-card-label">SIGNED IN</span><strong>{frame.data.user.name}</strong><small>{frame.data.user.role}</small></div>
    </div>

    <Panel className="records-panel">
      <div className="records-topline">
        <div className="records-count"><strong>{accounts.length}</strong><span>administrator accounts</span><span className="dot-separator" />{activeMains} main · {restricted} restricted</div>
        <Button size="small" variant="primary" onClick={() => setEditor({ mode: 'create' })}><Icon name="plus" size={14} />Add administrator</Button>
      </div>
      <div className="table-scroll"><table className="data-table admin-table">
        <thead><tr><th>Administrator</th><th>Access</th><th>Sections</th><th>Actions</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
        <tbody>
          {accounts.map((account) => {
            const isCurrent = account.email === currentEmail
            const statusChangeAllowed = canChangeStatus(account)
            return <tr key={account.id}>
              <td><span className="partner-cell"><span className="mini-avatar">{initials(account.name)}</span><span><b>{account.name}{isCurrent && <em className="admin-you">You</em>}</b><small>{account.email} · {account.title}</small></span></span></td>
              <td><StatusBadge status={account.role} /></td>
              <td><span className="admin-access-cell">{accessSummary(account)}</span></td>
              <td><span className="admin-access-cell">{actionSummary(account)}</span></td>
              <td><StatusBadge status={account.active ? 'Active' : 'Inactive'} /></td>
              <td>{account.lastSignedInAt ? <span className="admin-last-seen">{formatDate(account.lastSignedInAt)}</span> : <span className="muted-text">Never</span>}</td>
              <td><span className="row-action-group"><Button size="small" variant="quiet" onClick={() => setEditor({ mode: 'edit', accountId: account.id })}><Icon name="edit" size={13} />Edit</Button><Button size="small" variant={account.active ? 'secondary' : 'primary'} disabled={!statusChangeAllowed} title={!statusChangeAllowed ? isCurrent ? 'You cannot change your own access here.' : 'At least one active main administrator must remain.' : undefined} onClick={() => setStatusTarget(account)}>{account.active ? 'Deactivate' : 'Reactivate'}</Button></span></td>
            </tr>
          })}
        </tbody>
      </table>{accounts.length === 0 && <EmptyState title="No administrator accounts" detail="Add a main administrator or a restricted operations account to begin." />}</div>
      <div className="table-footer"><span>Main administrator access is limited to two active accounts.</span><span className="demo-caption">Directory stored in this browser · changes audited</span></div>
    </Panel>

    <p className="overview-footnote"><Icon name="shield" size={14} />Onboarding approvals and administrator management always stay with main administrators. Restricted accounts only receive the sections and actions selected here.</p>
    <p className="overview-footnote"><Icon name="info" size={14} />Administrator records are stored in this browser profile. Firebase Authentication, the email allow-list, and Firestore rules still control production sign-in and live data access.</p>

    {editor && <AdminEditorDialog account={editing} accounts={data.admins} onClose={() => setEditor(null)} />}
    {statusTarget && <ConfirmDialog
      title={`${statusTarget.active ? 'Deactivate' : 'Reactivate'} ${statusTarget.name}?`}
      detail={statusTarget.active
        ? 'The account will keep its recorded access but cannot sign in to the console until a main administrator reactivates it.'
        : 'The account will be able to sign in again with the access recorded on this profile. Main administrator limits still apply.'}
      reasonLabel={statusTarget.active ? 'Deactivation reason' : 'Reactivation note'}
      confirmLabel={statusTarget.active ? 'Deactivate account' : 'Reactivate account'}
      danger={statusTarget.active}
      onCancel={() => setStatusTarget(null)}
      onConfirm={(reason) => {
        dispatch({ type: 'admin.set-active', adminId: statusTarget.id, active: !statusTarget.active, reason })
        setStatusTarget(null)
      }}
    />}
  </div>
}

function AdminEditorDialog({ account, accounts, onClose }: { account: AdminAccount | undefined; accounts: AdminAccount[]; onClose: () => void }) {
  const { dispatch } = useOperations()
  const [name, setName] = useState(account?.name ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [title, setTitle] = useState(account?.title ?? '')
  const [role, setRole] = useState<AdminRole>(account?.role ?? 'Restricted Administrator')
  const [sections, setSections] = useState<AdminSection[]>(account?.sections ?? ['deliveries'])
  const [permissions, setPermissions] = useState<Permission[]>(account?.permissions ?? ['read'])
  const [error, setError] = useState('')
  const otherActiveMains = accounts.filter((item) => item.active && item.role === 'Main Administrator' && item.id !== account?.id).length
  const mainLimitReached = otherActiveMains >= 2

  function toggleSection(section: AdminSection) {
    if (!sections.includes(section)) {
      setSections([...sections, section])
      return
    }
    // Actions live inside a section, so removing the section removes its
    // action grants instead of silently restoring the section on save.
    const sectionActions = ADMIN_ACTION_OPTIONS.filter((option) => option.section === section).map((option) => option.permission)
    setSections(sections.filter((item) => item !== section))
    setPermissions(permissions.filter((permission) => !sectionActions.includes(permission)))
  }

  function togglePermission(permission: Permission) {
    const granted = permissions.includes(permission)
    setPermissions(granted ? permissions.filter((item) => item !== permission) : [...permissions, permission])
    const option = ADMIN_ACTION_OPTIONS.find((item) => item.permission === permission)
    if (!granted && option && !sections.includes(option.section)) setSections([...sections, option.section])
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid administrator email address.')
      return
    }
    if (!account && accounts.some((item) => item.email === normalizedEmail)) {
      setError('That email already has an administrator account.')
      return
    }
    if (role === 'Main Administrator' && mainLimitReached) {
      setError('Two main administrators already have full access. Change one of them to restricted first.')
      return
    }
    if (account) {
      dispatch({ type: 'admin.update', adminId: account.id, name, title, role, sections, permissions })
    } else {
      dispatch({ type: 'admin.create', name, email: normalizedEmail, title, role, sections, permissions })
    }
    onClose()
  }

  return <Dialog title={account ? `Edit ${account.name}` : 'Add administrator'} eyebrow="ADMINISTRATOR ACCESS" wide onClose={onClose}>
    <form className="dialog-form admin-editor" onSubmit={submit}>
      <p className="dialog-description">Main administrators have full access to every section and action. Restricted administrators only receive the sections and actions selected below.</p>

      <div className="form-grid two-columns">
        <label className="field-label">Full name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} placeholder="e.g. Priya Sharma" /></label>
        <label className="field-label">Work email<input type="email" value={email} disabled={Boolean(account)} onChange={(event) => setEmail(event.target.value)} required maxLength={120} placeholder="name@company.com" /><span className="field-help">{account ? 'The sign-in email is fixed after the account is created.' : 'This must match the email used for Firebase Authentication in production.'}</span></label>
        <label className="field-label span-two">Job title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Delivery Operations Coordinator" /></label>
      </div>

      <div className="admin-access-options" role="radiogroup" aria-label="Administrator access level">
        <button type="button" role="radio" aria-checked={role === 'Main Administrator'} className={`admin-access-option ${role === 'Main Administrator' ? 'active' : ''}`} disabled={mainLimitReached && account?.role !== 'Main Administrator'} onClick={() => setRole('Main Administrator')}>
          <span className="admin-access-icon"><Icon name="shield" size={16} /></span>
          <span><strong>Main administrator</strong><small>Full access, onboarding decisions, and administrator management.</small></span>
          {role === 'Main Administrator' && <Icon name="check-circle" size={17} />}
        </button>
        <button type="button" role="radio" aria-checked={role === 'Restricted Administrator'} className={`admin-access-option ${role === 'Restricted Administrator' ? 'active' : ''}`} onClick={() => setRole('Restricted Administrator')}>
          <span className="admin-access-icon"><Icon name="user" size={16} /></span>
          <span><strong>Restricted administrator</strong><small>Only the console sections and actions selected below.</small></span>
          {role === 'Restricted Administrator' && <Icon name="check-circle" size={17} />}
        </button>
      </div>
      {mainLimitReached && <div className="settings-note"><Icon name="lock" size={15} /><span>Two active main administrators already have full access. Change one of them to restricted before adding another main administrator.</span></div>}

      {role === 'Restricted Administrator' ? <>
        <div className="admin-permission-section">
          <div className="admin-permission-heading"><strong>Allowed sections</strong><span>Choose which console pages this account can open.</span></div>
          <div className="admin-permission-grid">
            {ADMIN_SECTION_OPTIONS.map((option) => <label key={option.section} className={`admin-permission-option ${sections.includes(option.section) ? 'selected' : ''}`}>
              <input type="checkbox" checked={sections.includes(option.section)} onChange={() => toggleSection(option.section)} />
              <span><strong>{option.label}</strong><small>{option.detail}</small></span>
            </label>)}
          </div>
        </div>

        <div className="admin-permission-section">
          <div className="admin-permission-heading"><strong>Allowed actions</strong><span>View-only access is kept when no actions are selected.</span></div>
          <div className="admin-permission-grid">
            {ADMIN_ACTION_OPTIONS.map((option) => <label key={option.permission} className={`admin-permission-option ${permissions.includes(option.permission) ? 'selected' : ''}`}>
              <input type="checkbox" checked={permissions.includes(option.permission)} onChange={() => togglePermission(option.permission)} />
              <span><strong>{option.label}</strong><small>{option.detail}</small></span>
            </label>)}
          </div>
        </div>

        <div className="settings-note"><Icon name="lock" size={15} /><span>Onboarding approvals and administrator management cannot be delegated. They always stay with main administrators.</span></div>
      </> : <div className="admin-full-access-note"><Icon name="shield" size={16} /><div><strong>Full administrator access</strong><span>Every section is available, including KYC Review, Audit Logs, Settings, and Administrators. Up to two active accounts can hold this access.</span></div></div>}

      {!account && <div className="settings-note"><Icon name="info" size={15} /><span>The email must already belong to a Firebase Authentication user in production and be included in <strong>VITE_ADMIN_EMAILS</strong>. In demo mode, the recorded email can sign in with the demo OTP.</span></div>}
      {error && <div className="admin-form-error" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}

      <div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary"><Icon name="check" size={15} />{account ? 'Save access' : 'Add administrator'}</Button></div>
    </form>
  </Dialog>
}
