require('dotenv').config();
const Admin = require('./models/Admin');
const connectDB = require('./config/db');
const { requireEnv } = require('./utils/requireEnv');

const User = require('./models/User');

const reset = async () => {
  // Which account gets reset, and to what password, must always be an
  // explicit, deliberate choice — validated before any MongoDB connection,
  // never a hardcoded default. This never silently changes which account
  // the script targets: an unset var aborts, it never falls back to a
  // different identity.
  const adminEmail    = requireEnv('RESET_ADMIN_EMAIL');
  const adminPassword = requireEnv('RESET_ADMIN_PASSWORD');
  const opEmail    = requireEnv('RESET_OPERATOR_EMAIL');
  const opPassword = requireEnv('RESET_OPERATOR_PASSWORD');

  await connectDB();

  // Admin
  let admin = await Admin.findOne({ email: adminEmail });
  if (admin) {
    admin.password = adminPassword;
    await admin.save();
    console.log(`✅ Password reset for ${adminEmail}`);
  } else {
    await Admin.create({ name: 'Super Admin', email: adminEmail, password: adminPassword, role: 'superadmin', isActive: true });
    console.log(`✅ SuperAdmin created`);
  }

  // Operator
  let user = await User.findOne({ email: opEmail });
  if (user) {
    user.password = opPassword;
    await user.save();
    console.log(`✅ Password reset for ${opEmail}`);
  } else {
    await User.create({ name: 'Operator', email: opEmail, password: opPassword, role: 'operator', isActive: true });
    console.log(`✅ Operator created`);
  }

  process.exit(0);
};

reset().catch(err => {
  console.error(err);
  process.exit(1);
});
