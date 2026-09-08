require('dotenv').config();
const Admin = require('./models/Admin');
const connectDB = require('./config/db');

const User = require('./models/User');

const reset = async () => {
  await connectDB();
  
  // Admin
  const adminEmail = 'superadmin@induscore.com';
  const adminPassword = 'Admin@1234';
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
  const opEmail = 'operator@induscore.com';
  const opPassword = 'Operator@1234';
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
