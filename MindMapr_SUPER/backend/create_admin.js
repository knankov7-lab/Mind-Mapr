const bcrypt = require('bcryptjs');
const { initDatabase, insertUser, getUserByEmail } = require('./db');

(async () => {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const username = process.env.ADMIN_USERNAME || 'admin';

  try {
    await initDatabase();
    const existing = await getUserByEmail(email);
    if (existing) {
      console.log(`User ${email} already exists (role=${existing.role}).`);
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await insertUser(email, username, passwordHash, 'admin');
    const user = await getUserByEmail(email);
    console.log('Admin user created:');
    console.log({ id: user.id, email: user.email, username: user.username, role: user.role });
    console.log('\nCredentials:');
    console.log(`  email: ${email}`);
    console.log(`  password: ${password}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin:', err);
    process.exit(1);
  }
})();
