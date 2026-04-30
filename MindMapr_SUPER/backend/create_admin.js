const bcrypt = require('bcryptjs');
const { initDatabase, insertUser, getUserByEmail } = require('./db');

(async () => {
  const args = process.argv.slice(2);
  const roleArg = args.find((arg) => arg.startsWith('--role='));
  const emailArg = args.find((arg) => arg.startsWith('--email='));
  const passwordArg = args.find((arg) => arg.startsWith('--password='));
  const usernameArg = args.find((arg) => arg.startsWith('--username='));

  const allowedRoles = ['admin', 'super-admin', 'ops-admin'];
  const requestedRole = (roleArg ? roleArg.split('=')[1] : process.env.ACCOUNT_ROLE || process.env.ADMIN_ROLE || 'super-admin').toLowerCase();
  const role = allowedRoles.includes(requestedRole) ? requestedRole : 'super-admin';

  const email = (emailArg ? emailArg.split('=')[1] : process.env.ACCOUNT_EMAIL || process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = passwordArg ? passwordArg.split('=')[1] : process.env.ACCOUNT_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';
  const username = usernameArg ? usernameArg.split('=')[1] : process.env.ACCOUNT_USERNAME || process.env.ADMIN_USERNAME || 'admin';

  try {
    await initDatabase();
    const existing = await getUserByEmail(email);
    if (existing) {
      console.log(`User ${email} already exists (role=${existing.role}).`);
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await insertUser(email, username, passwordHash, role);
    const user = await getUserByEmail(email);
    console.log('Admin-level user created:');
    console.log({ id: user.id, email: user.email, username: user.username, role: user.role });
    console.log('\nCredentials:');
    console.log(`  email: ${email}`);
    console.log(`  password: ${password}`);
    console.log(`  role: ${role}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin:', err);
    process.exit(1);
  }
})();
