const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');

test('run throws when database is not initialized', async () => {
  await assert.rejects(() => db.run('SELECT 1'), /Database not initialized/);
});

test('get throws when database is not initialized', async () => {
  await assert.rejects(() => db.get('SELECT 1'), /Database not initialized/);
});

test('all throws when database is not initialized', async () => {
  await assert.rejects(() => db.all('SELECT 1'), /Database not initialized/);
});

test('exec throws when database is not initialized', async () => {
  await assert.rejects(() => db.exec('SELECT 1;'), /Database not initialized/);
});

test('initDatabase throws when TURSO_URL is missing', async () => {
  const prevUrl = process.env.TURSO_URL;
  const prevToken = process.env.TURSO_AUTH_TOKEN;

  try {
    delete process.env.TURSO_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    await assert.rejects(() => db.initDatabase(), /TURSO_URL env var is required/);
  } finally {
    if (prevUrl === undefined) delete process.env.TURSO_URL;
    else process.env.TURSO_URL = prevUrl;

    if (prevToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = prevToken;
  }
});

test('insertTeam validates missing name', async () => {
  await assert.rejects(() => db.insertTeam('', 1), /team name required/);
});

test('updateUserPasswordHash validates missing hash', async () => {
  await assert.rejects(() => db.updateUserPasswordHash(5, ''), /password hash required/);
});

test('updateRoomTeam validates missing room', async () => {
  await assert.rejects(() => db.updateRoomTeam('', 1), /room required/);
});

test('updateRoomTeam validates invalid team id', async () => {
  await assert.rejects(() => db.updateRoomTeam('room-a', -5), /invalid teamId/);
});

test('updateRoomTeam accepts null team id and reaches db layer', async () => {
  await assert.rejects(() => db.updateRoomTeam('room-a', null), /Database not initialized/);
});

test('insertComment validates missing room', async () => {
  await assert.rejects(() => db.insertComment('', 1, null, 'text'), /room required/);
});

test('insertComment validates missing content', async () => {
  await assert.rejects(() => db.insertComment('room-a', 1, null, '   '), /content required/);
});

test('listCommentsForRoom returns empty array for missing room', async () => {
  const result = await db.listCommentsForRoom('   ');
  assert.deepEqual(result, []);
});

test('insertLog validates missing action', async () => {
  await assert.rejects(() => db.insertLog(1, ''), /action required/);
});

test('insertPasswordReset validates missing token hash', async () => {
  await assert.rejects(() => db.insertPasswordReset(1, '', '2026-01-01 00:00:00'), /token hash required/);
});

test('insertPasswordReset validates missing expires', async () => {
  await assert.rejects(() => db.insertPasswordReset(1, 'abc', ''), /expires required/);
});

test('listAiExamples returns empty array when intent is missing', async () => {
  const result = await db.listAiExamples('');
  assert.deepEqual(result, []);
});

test('insertAiExample validates missing intent', async () => {
  await assert.rejects(() => db.insertAiExample('', 'in', 'out'), /intent required/);
});

test('insertAiExample validates whitespace-only intent', async () => {
  await assert.rejects(() => db.insertAiExample('   ', 'in', 'out'), /intent required/);
});

test('insertAiExample validates missing output', async () => {
  await assert.rejects(() => db.insertAiExample('chat', 'in', '   '), /output required/);
});

test('insertInvite validates missing token', async () => {
  await assert.rejects(() => db.insertInvite('', 'room-a', 'viewer'), /token required/);
});

test('insertInvite validates missing room', async () => {
  await assert.rejects(() => db.insertInvite('tok', '', 'viewer'), /room required/);
});

test('setTeamMemberRole falls back to default role and reaches db layer', async () => {
  await assert.rejects(() => db.setTeamMemberRole(1, 7, 'not-a-role'), /Database not initialized/);
});

test('upsertRoomMemberRole falls back to default role and reaches db layer', async () => {
  await assert.rejects(() => db.upsertRoomMemberRole('room-a', 7, 'invalid-role', null), /Database not initialized/);
});

test('listPublicRooms with invalid limit still reaches db layer', async () => {
  await assert.rejects(() => db.listPublicRooms('invalid-limit'), /Database not initialized/);
});

test('getInviteByToken returns null for empty token', async () => {
  const result = await db.getInviteByToken('');
  assert.equal(result, null);
});

test('deleteInviteByToken returns null for empty token', async () => {
  const result = await db.deleteInviteByToken('');
  assert.equal(result, null);
});

test('markInviteUsed returns null for empty token', async () => {
  const result = await db.markInviteUsed('');
  assert.equal(result, null);
});
