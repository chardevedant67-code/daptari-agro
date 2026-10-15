import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

const show = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));

// Shown from the Excel Data Manager when a row's change could not be saved:
//  - conflict: someone else changed the record first. The user picks which
//    values stand; nothing is overwritten until they do.
//  - error: the server rejected the change. The user retries or discards it.
export default function ConflictDialog({ row, columns, onResolve, onRetry, onDiscard, onClose }) {
  if (!row) return null;
  const isConflict = row.syncState === 'conflict';
  const server = row.conflictRecord;
  const differing = isConflict && server
    ? columns.filter(({ field }) => show(row[field]) !== show(server[field]))
    : [];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="issue-dialog">
      <DialogTitle>{isConflict ? 'This record was changed by someone else' : 'This change could not be saved'}</DialogTitle>
      <DialogContent dividers>
        {isConflict ? (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Your change has not been saved. Choose which values to keep.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Column</TableCell>
                  <TableCell>Yours</TableCell>
                  <TableCell>On the server</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {differing.map(({ field, header }) => (
                  <TableRow key={field}>
                    <TableCell>{header}</TableCell>
                    <TableCell data-testid={`mine-${field}`}>{show(row[field])}</TableCell>
                    <TableCell data-testid={`server-${field}`}>{show(server[field])}</TableCell>
                  </TableRow>
                ))}
                {!differing.length && (
                  <TableRow><TableCell colSpan={3}>Your values and the server's are now the same.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </>
        ) : (
          <Alert severity="error" data-testid="issue-message">{row.syncMessage || 'The server rejected this change.'}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Decide later</Button>
        {isConflict ? (
          <>
            <Button onClick={() => onResolve(row.recordId, 'server')} data-testid="use-server">Use the server's</Button>
            <Button variant="contained" onClick={() => onResolve(row.recordId, 'mine')} data-testid="keep-mine">Keep mine</Button>
          </>
        ) : (
          <>
            <Button color="error" onClick={() => onDiscard(row.recordId)} data-testid="discard-change">Discard my change</Button>
            <Button variant="contained" onClick={() => onRetry(row.recordId)} data-testid="retry-change">Try again</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
