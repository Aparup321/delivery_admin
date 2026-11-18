import type { AdminSession } from '../auth/adminSession'
import { ADMIN_PERMISSIONS } from '../domain/admin'
import type { AdminUser } from '../domain/model'
import { Button, Dialog, formatDate, Icon, initials, StatusBadge } from './ui'

interface Props {
  user: AdminUser
  session: AdminSession
  onClose: () => void
  onSignOut: () => void
}

export function AdminAccountDialog({ user, session, onClose, onSignOut }: Props) {
  return <Dialog title="Administrator account" eyebrow="OPS TEAM · ADMINISTRATOR" onClose={onClose}>
    <div className="admin-account">
      <div className="admin-account-hero">
        <span className="profile-large-avatar admin-account-avatar">{initials(user.name)}</span>
        <div><span className="summary-card-label">SIGNED IN AS</span><strong>{user.name}</strong><small>{user.title}</small></div>
        <StatusBadge status={user.role} />
      </div>

      <div className="admin-account-grid">
        <div><span>Account ID</span><strong>{user.id}</strong></div>
        <div><span>Administrative role</span><strong>Admin</strong></div>
        <div><span>Work email</span><strong>{user.email}</strong></div>
        <div><span>Contact</span><strong>{user.maskedPhone}</strong></div>
        <div><span>Signed in</span><strong>{formatDate(session.signedInAt)}</strong></div>
        <div><span>Access method</span><strong>{session.mode}</strong></div>
      </div>

      <div className="admin-account-permissions">
        <span className="summary-card-label">ADMINISTRATOR PERMISSIONS</span>
        <ul>{ADMIN_PERMISSIONS.map((permission) => <li key={permission}><span><Icon name="check" size={12} /></span>{permission}</li>)}</ul>
      </div>

      <div className="admin-account-note"><Icon name="shield" size={15} /><span>This profile stays connected on this browser until you sign out. The password is never stored by the console; sign out on shared computers.</span></div>
      <div className="dialog-actions"><Button onClick={onClose}>Close</Button><Button variant="danger" onClick={onSignOut}><Icon name="logout" size={15} />Sign out</Button></div>
    </div>
  </Dialog>
}