import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';

// Add-record form for the Excel Data Manager (Superadmin only): one input
// per Excel column, in Excel order. Every field starts empty — nothing is
// pre-filled or suggested.
export default function AddRecordDialog({ open, columns, onSave, onClose }) {
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function close() {
    setValues({});
    setError('');
    onClose();
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSave(values);
      close();
    } catch (err) {
      setError(err.message || 'Could not save the record.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth data-testid="add-dialog">
      <Box component="form" onSubmit={save} noValidate>
        <DialogTitle>Add record</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="add-error">{error}</Alert>}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
            {columns.map(({ field, header, type }) => (
              <TextField
                key={field}
                label={header}
                size="small"
                value={values[field] ?? ''}
                onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))}
                multiline={field === 'comments' || field === 'finalReport'}
                slotProps={{ htmlInput: { 'data-testid': `add-${field}`, inputMode: type === 'number' ? 'decimal' : 'text' } }}
              />
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy} data-testid="add-save">Save record</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
