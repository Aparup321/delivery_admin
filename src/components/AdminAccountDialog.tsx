import type { AdminSession } from '../auth/adminSession'
import { PERMISSION_LABELS, isMainAdministrator, sectionLabels } from '../domain/admin'
import type { AdminUser } from '../domain/model'
import { Button, Dialog, formatDate, Icon, initials, StatusBadge } from './ui'

interface Props {
  user: AdminUser
  session: AdminSession
  onClose: () => void
  onSignOut: () => void
}

export function AdminAccountDialog({ user, session, onClose, onSignOut }: Props) {
  const main = isMainAdministrator(user)
  const sections = sectionLabels(user.sections)
  const actions = user.permissions
    .filter((permission) => permission !== 'read')
    .map((permission) => PERMISSION_LABELS[permission])

  return <Dialog title="Administrator account" eyebrow="OPS TEAM · ADMINISTRATOR" onClose={onClose}>
    <div className="admin-account">
      <div className="admin-account-hero">
        <span className="profile-large-avatar admin-account-avatar">{initials(user.name)}</span>
        <div><span className="summary-card-label">SIGNED IN AS</span><strong>{user.name}</strong><small>{user.title}</small></div>
        <StatusBadge status={user.role} />
      </div>

      <div className="admin-account-grid">
        <div><span>Account ID</span><strong>{user.id}</strong></div>
        <div><span>Administrative role</span><strong>{user.role}</strong></div>
        <div><span>Work email</span><strong>{user.email}</strong></div>
        <div><span>Contact</span><strong>{user.maskedPhone}</strong></div>
        <div><span>Signed in</span><strong>{formatDate(session.signedInAt)}</strong></div>
        <div><span>Access method</span><strong>{session.mode}</strong></div>
      </div>

      <div className="admin-account-permissions">
        <span className="summary-card-label">{main ? 'FULL ADMINISTRATOR ACCESS' : 'GRANTED ACCESS'}</span>
        {main
          ? <div className="admin-account-access-note"><Icon name="shield" size={14} /><span>Every section is available, including onboarding decisions and administrator management.</span></div>
          : <>
            <div className="admin-account-access-group"><span>Sections</span>{sections.length ? <ul>{sections.map((section) => <li key={section}><span><Icon name="check" size={12} /></span>{section}</li>)}</ul> : <p>No console sections have been granted.</p>}</div>
            <div className="admin-account-access-group"><span>Actions</span>{actions.length ? <ul>{actions.map((action) => <li key={action}><span><Icon name="check" size={12} /></span>{action}</li>)}</ul> : <p>View-only access.</p>}</div>
          </>}
      </div>

      {!main && <div className="admin-account-note"><Icon name="info" size={15} /><span>Your access is set by a main administrator. Ask a main administrator to change your sections or actions.</span></div>}
      {main && <div className="admin-account-note"><Icon name="shield" size={15} /><span>Up to two main administrators can hold full access. You can manage the rest of the team from Administrators.</span></div>}
      <div className="admin-account-note"><Icon name="lock" size={15} /><span>This profile stays connected on this browser until you sign out. The password is never stored by the console; sign out on shared computers.</span></div>
      <div className="dialog-actions"><Button onClick={onClose}>Close</Button><Button variant="danger" onClick={onSignOut}><Icon name="logout" size={15} />Sign out</Button></div>
    </div>
  </Dialog>
}
