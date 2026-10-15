import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { DataGrid } from '@mui/x-data-grid';

const STATE_CHIP = {
  synced:   { label: 'Synced',   color: 'success', hint: 'Saved on the server' },
  pending:  { label: 'Pending',  color: 'warning', hint: 'Not yet saved on the server' },
  conflict: { label: 'Conflict', color: 'error',   hint: 'Changed by someone else — click to decide' },
  error:    { label: 'Error',    color: 'error',   hint: 'Could not be saved — click for details' },
};

// What an empty table means is never left to guesswork: `emptyState` says
// whether records are still loading, could not be loaded, or the server
// really returned none.
function EmptyOverlay({ emptyState }) {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3, textAlign: 'center' }}>
      <Typography
        variant="body2"
        color={emptyState.kind === 'error' ? 'error' : 'text.secondary'}
        data-testid="grid-empty"
        data-kind={emptyState.kind}
        sx={{ maxWidth: 560 }}
      >
        {emptyState.message}
      </Typography>
    </Box>
  );
}

// The Excel-style table: the 24 columns in their Excel order, preceded by
// one narrow status column that exists only on screen (it is not part of
// the workbook).
export default function RecordGrid({ rows, columns, packetDerived, canManage, loading, emptyState, onEdit, onEditError, onOpenIssue }) {
  const gridColumns = useMemo(() => {
    const statusColumn = {
      field: 'syncState',
      headerName: 'Status',
      width: 112,
      sortable: true,
      filterable: false,
      editable: false,
      disableColumnMenu: true,
      renderCell: (params) => {
        const chip = STATE_CHIP[params.value] || STATE_CHIP.synced;
        const actionable = params.value === 'conflict' || params.value === 'error';
        return (
          <Tooltip title={params.row.syncMessage || chip.hint}>
            <Chip
              size="small"
              variant={params.value === 'synced' ? 'outlined' : 'filled'}
              color={chip.color}
              label={chip.label}
              data-testid={`row-state-${params.value}`}
              onClick={actionable ? () => onOpenIssue(params.row) : undefined}
            />
          </Tooltip>
        );
      },
    };

    const dataColumns = columns.map(({ header, field, type }) => ({
      field,
      headerName: header,
      type: type === 'number' ? 'number' : 'string',
      width: Math.max(header.length * 9 + 48, type === 'number' ? 110 : 150),
      editable: canManage,
      // Plain values, as they will appear in Excel (no thousands separators).
      valueFormatter: (value) => (value === null || value === undefined ? '' : String(value)),
    }));

    return [statusColumn, ...dataColumns];
  }, [columns, canManage, onOpenIssue]);

  return (
    <DataGrid
      rows={rows}
      columns={gridColumns}
      getRowId={(row) => row.recordId}
      density="compact"
      loading={loading}
      slots={{ noRowsOverlay: EmptyOverlay }}
      showToolbar
      disableRowSelectionOnClick
      showCellVerticalBorder
      showColumnVerticalBorder
      // Only a Superadmin can edit, and never the columns a packet-linked
      // record takes from its batch. (The backend enforces both as well.)
      isCellEditable={(params) => canManage
        && params.field !== 'syncState'
        && !(params.row.linked && packetDerived.includes(params.field))}
      processRowUpdate={async (newRow, oldRow) => {
        const changes = {};
        for (const { field } of columns) {
          const before = oldRow[field] ?? null;
          const after = newRow[field] ?? null;
          if (before !== after && !(before === '' && after === null) && !(before === null && after === '')) {
            changes[field] = newRow[field];
          }
        }
        if (!Object.keys(changes).length) return oldRow;
        const queued = await onEdit(oldRow.recordId, changes);
        return queued ? { ...newRow, syncState: oldRow.syncState === 'synced' ? 'pending' : oldRow.syncState } : oldRow;
      }}
      onProcessRowUpdateError={onEditError}
      initialState={{ pagination: { paginationModel: { pageSize: 100 } } }}
      pageSizeOptions={[50, 100]}
      slotProps={{
        noRowsOverlay: { emptyState },
        toolbar: {
          showQuickFilter: true,
          // The workbook is the one output of this app; the grid's own
          // CSV/print export would bypass it (and could include unsaved rows).
          csvOptions: { disableToolbarButton: true },
          printOptions: { disableToolbarButton: true },
        },
      }}
      sx={{
        bgcolor: 'background.paper',
        '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 700 },
        '& .MuiDataGrid-cell--editable': canManage ? { cursor: 'text' } : {},
      }}
    />
  );
}
