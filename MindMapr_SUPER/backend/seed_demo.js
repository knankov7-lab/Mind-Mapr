const { initDatabase, insertUser, insertRoom, insertSave, getUserByEmail } = require('./db');
const bcrypt = require('bcryptjs');

(async () => {
  await initDatabase();
  // Demo users
  const users = [
    { email: 'admin@example.com', username: 'admin', password: 'admin123', role: 'admin' },
    { email: 'alice@example.com', username: 'alice', password: 'alice123', role: 'user' },
    { email: 'bob@example.com', username: 'bob', password: 'bob123', role: 'user' },
    { email: 'eva@example.com', username: 'eva', password: 'eva123', role: 'user' }
  ];
  for (const u of users) {
    const exists = await getUserByEmail(u.email);
    if (!exists) {
      const hash = await bcrypt.hash(u.password, 10);
      await insertUser(u.email, u.username, hash, u.role);
    }
  }
  // Demo rooms
  const roomList = [
    { room_id: 'team1', name: 'Екип 1', created_by: 2 },
    { room_id: 'team2', name: 'Екип 2', created_by: 3 },
    { room_id: 'public1', name: 'Публична карта', created_by: 2 },
    { room_id: 'public2', name: 'Публична карта 2', created_by: 4 }
  ];
  for (const r of roomList) {
    await insertRoom(r.room_id, r.name, r.created_by);
  }
  // Demo saves
  const demoNodes = [
    { id: 'root', position: { x: 0, y: 0 }, data: { label: 'Главна тема' }, type: 'default' },
    { id: 'idea1', position: { x: 120, y: 80 }, data: { label: 'Идея 1' }, type: 'default' },
    { id: 'idea2', position: { x: -100, y: 60 }, data: { label: 'Идея 2' }, type: 'default' }
  ];
  const demoEdges = [
    { id: 'e-root-idea1', source: 'root', target: 'idea1', animated: true },
    { id: 'e-root-idea2', source: 'root', target: 'idea2', animated: true }
  ];
  for (const r of roomList) {
    for (let i = 0; i < 3; i++) {
      await insertSave(r.room_id, JSON.stringify(demoNodes), JSON.stringify(demoEdges), r.created_by);
    }
  }
  console.log('Demo data seeded.');
})();