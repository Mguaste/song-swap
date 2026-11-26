import { AdminGrowth } from './settings/AdminGrowth';
import { AdminAnnouncements } from './settings/AdminAnnouncements';
import { AdminResetPassword } from './settings/AdminResetPassword';
import { AdminReports } from './settings/AdminReports';
import { AdminShares } from './settings/AdminShares';
import { AdminImportHistory } from './settings/AdminImportHistory';

// Admin tools as their own page (reached from the Admin button in the header)
export function AdminPage({ onBack }) {
  return (
    <div id="settings-page">
      <button className="link-btn" id="settings-back" onClick={onBack}>← Back</button>
      <h2 className="page-heading">Admin</h2>

      <div className="settings-section">
        <h2 className="settings-section-title">Reports</h2>
        <AdminReports />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Growth</h2>
        <AdminGrowth />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Memo to Users</h2>
        <AdminAnnouncements />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Song Links</h2>
        <AdminShares />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Import History</h2>
        <AdminImportHistory />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Reset a Password</h2>
        <AdminResetPassword />
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Danger Zone</h2>
        <div className="settings-row">
          <label className="settings-label">History</label>
          <button className="settings-danger-btn" onClick={() => fetch('/api/admin/history', { method: 'DELETE', credentials: 'include' })}>Clear All History</button>
        </div>
        <div className="settings-row">
          <label className="settings-label">Current Songs</label>
          <button className="settings-danger-btn" onClick={() => fetch('/api/admin/current-song', { method: 'DELETE', credentials: 'include' })}>Clear Current Songs</button>
        </div>
      </div>
    </div>
  );
}
