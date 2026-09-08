require('dotenv').config();
const Admin = require('./models/Admin');
const Machine = require('./models/Machine');
const connectDB = require('./config/db');

const MACHINES = [
  { machineId: 'MAC-001', name: 'Industrial Scale XS-200', line: 'Packing Line A', location: 'Bay 1', category: 'packing',  status: 'Running',     efficiency: 98, runtime: 18.5 },
  { machineId: 'MAC-002', name: 'AutoWeigh Pro 500',        line: 'Packing Line A', location: 'Bay 2', category: 'packing',  status: 'Running',     efficiency: 45, runtime: 18.5 },
  { machineId: 'MAC-003', name: 'PrecisionScale MK3',       line: 'Sorting Line B', location: 'Bay 3', category: 'sorting',  status: 'Standby',     efficiency: 12, runtime: 4.2  },
  { machineId: 'MAC-004', name: 'HeavyDuty Scale HD-1',     line: 'Filling Line C', location: 'Bay 1', category: 'filling',  status: 'Maintenance', efficiency: 0,  runtime: 0    },
  { machineId: 'MAC-005', name: 'MicroScale MS-100',        line: 'Distribution D', location: 'Bay 2', category: 'other',    status: 'Fault',       efficiency: 15, runtime: 2.1  },
];

const seed = async () => {
  await connectDB();

  // Seed SuperAdmin
  const existing = await Admin.findOne({ email: 'superadmin@induscore.com' });
  if (!existing) {
    await Admin.create({ name: 'Super Admin', email: 'superadmin@induscore.com', password: 'Admin@1234', role: 'superadmin', isActive: true });
    console.log('✅ SuperAdmin seeded: superadmin@induscore.com / Admin@1234');
  } else {
    console.log('⚠️  SuperAdmin already exists — skipping');
  }

  // Seed default Operator user (for mobile app)
  const User = require('./models/User');
  const existingUser = await User.findOne({ email: 'operator@induscore.com' });
  if (!existingUser) {
    await User.create({ name: 'Operator', email: 'operator@induscore.com', password: 'Operator@1234', role: 'operator', isActive: true });
    console.log('✅ Operator seeded: operator@induscore.com / Operator@1234');
  } else {
    console.log('⚠️  Operator already exists — skipping');
  }

  // Seed Machines
  const machineCount = await Machine.countDocuments();
  if (machineCount === 0) {
    await Machine.insertMany(MACHINES);
    console.log(`✅ ${MACHINES.length} machines seeded`);
  } else {
    console.log('⚠️  Machines already exist — skipping');
  }

  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Seed error:', err.message);
  process.exit(1);
});
