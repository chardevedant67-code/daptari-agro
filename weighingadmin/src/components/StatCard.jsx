import { Box, Card, Typography, Chip } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';

export default function StatCard({ title, value, trend, trendLabel, icon, iconBg, sub }) {
  const isPositive = trend && !trend.startsWith('-');
  return (
    <Card sx={{ p: 2.5, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: iconBg || 'rgba(26,34,127,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </Box>
        {trend && (
          <Chip
            size="small"
            icon={isPositive ? <TrendingUpIcon sx={{ fontSize: '14px !important' }} /> : <TrendingDownIcon sx={{ fontSize: '14px !important' }} />}
            label={trend}
            sx={{
              fontSize: 11, fontWeight: 700, height: 24,
              background: isPositive ? '#dcfce7' : '#fee2e2',
              color: isPositive ? '#16a34a' : '#dc2626',
              '& .MuiChip-icon': { color: 'inherit' }
            }}
          />
        )}
      </Box>
      <Typography sx={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>{value}</Typography>
      <Typography sx={{ fontSize: 13, color: '#64748b', mt: 0.5, fontWeight: 500 }}>{title}</Typography>
      {sub && <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.3 }}>{sub}</Typography>}
    </Card>
  );
}
