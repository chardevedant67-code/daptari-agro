import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function timeOf(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// "Saved" is only ever shown when nothing is waiting: every change has been
// confirmed by the backend.
function describe(status) {
  switch (status.state) {
    case 'syncing':
      return { color: 'info', label: status.loading ? 'Loading records from the server…' : 'Syncing…' };
    case 'offline':
      return {
        color: 'warning',
        label: status.pending
          ? `Offline — ${plural(status.pending, 'change')} will be sent when the connection returns`
          : (status.recordCount ? 'Offline — showing the last downloaded records' : 'Offline — the server cannot be reached'),
      };
    case 'error':
      return { color: 'error', label: status.lastError || 'Sync failed' };
    case 'conflict':
      return { color: 'error', label: `${plural(status.conflicts, 'conflict')} — your decision is needed` };
    case 'attention':
      return { color: 'error', label: `${plural(status.errors, 'change')} could not be saved` };
    case 'pending':
      return { color: 'warning', label: `${plural(status.pending, 'change')} waiting to be saved` };
    case 'synced':
      return { color: 'success', label: 'Up to date with the server' };
    default:
      return { color: 'default', label: 'Not synced yet' };
  }
}

export default function SyncStatusBar({ status }) {
  if (!status) return null;
  const { color, label } = describe(status);
  const details = [
    status.lastSyncAt ? `Last sync ${timeOf(status.lastSyncAt)}` : null,
    status.nextRetryAt && status.state !== 'syncing' ? `retrying at ${timeOf(status.nextRetryAt)}` : null,
    status.loading ? null : (
      Number.isInteger(status.serverRecordCount) && status.serverRecordCount !== status.recordCount
        ? `${status.recordCount} of ${plural(status.serverRecordCount, 'record')} loaded`
        : `${plural(status.recordCount, 'record')} loaded`
    ),
  ].filter(Boolean).join(' · ');

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
      <Tooltip title={label}>
        <Chip
          size="small"
          color={color}
          label={label}
          data-testid="sync-status"
          data-state={status.state}
          sx={{ maxWidth: 460, fontWeight: 600 }}
        />
      </Tooltip>
      <Typography variant="caption" color="text.secondary" noWrap data-testid="sync-details">{details}</Typography>
    </Stack>
  );
}
