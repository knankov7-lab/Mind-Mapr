const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const {
  authMiddleware,
  requireAuth,
  requireAdmin,
  hashPassword,
  verifyToken,
} = require('../auth');

const JWT_SECRET = process.env.JWT_SECRET || 'mindmapr-dev-secret';

function createResMock() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('hashPassword returns hash string', async () => {
  const hash = await hashPassword('secret123');
  assert.equal(typeof hash, 'string');
  assert.ok(hash.length > 20);
});

test('hashPassword does not return plain password', async () => {
  const password = 'secret123';
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
});

test('hashPassword result can be verified with bcrypt', async () => {
  const password = 'secret123';
  const hash = await hashPassword(password);
  const ok = await bcrypt.compare(password, hash);
  assert.equal(ok, true);
});

test('verifyToken returns decoded payload for valid token', () => {
  const payload = { id: 7, email: 'u@example.com', role: 'user' };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '5m' });
  const decoded = verifyToken(token);

  assert.equal(decoded.id, payload.id);
  assert.equal(decoded.email, payload.email);
  assert.equal(decoded.role, payload.role);
});

test('verifyToken returns null for invalid token string', () => {
  const decoded = verifyToken('not-a-valid-jwt');
  assert.equal(decoded, null);
});

test('verifyToken returns null for missing token', () => {
  const decoded = verifyToken(undefined);
  assert.equal(decoded, null);
});

test('verifyToken returns null for expired token', () => {
  const token = jwt.sign({ id: 11, role: 'user' }, JWT_SECRET, { expiresIn: -1 });
  const decoded = verifyToken(token);
  assert.equal(decoded, null);
});

test('authMiddleware sets req.user to null when Authorization header is missing', () => {
  const req = { headers: {} };
  const nextCalls = { count: 0 };

  authMiddleware(req, {}, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 1);
  assert.equal(req.user, null);
});

test('authMiddleware sets req.user to null when header is not Bearer', () => {
  const req = { headers: { authorization: 'Basic abc123' } };
  const nextCalls = { count: 0 };

  authMiddleware(req, {}, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 1);
  assert.equal(req.user, null);
});

test('authMiddleware sets req.user for valid Bearer token', () => {
  const payload = { id: 9, email: 'admin@example.com', role: 'admin' };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '5m' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const nextCalls = { count: 0 };

  authMiddleware(req, {}, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 1);
  assert.equal(req.user.id, payload.id);
  assert.equal(req.user.email, payload.email);
  assert.equal(req.user.role, payload.role);
});

test('authMiddleware sets req.user to null for invalid Bearer token', () => {
  const req = { headers: { authorization: 'Bearer invalid-token' } };
  const nextCalls = { count: 0 };

  authMiddleware(req, {}, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 1);
  assert.equal(req.user, null);
});

test('authMiddleware does not accept lowercase bearer prefix', () => {
  const payload = { id: 15, email: 'lower@example.com', role: 'user' };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '5m' });
  const req = { headers: { authorization: `bearer ${token}` } };
  const nextCalls = { count: 0 };

  authMiddleware(req, {}, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 1);
  assert.equal(req.user, null);
});

test('requireAuth calls next when req.user exists', () => {
  const req = { user: { id: 1, role: 'user' } };
  const res = createResMock();
  const nextCalls = { count: 0 };

  requireAuth(req, res, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('requireAuth returns 401 when req.user is missing', () => {
  const req = { user: null };
  const res = createResMock();
  const nextCalls = { count: 0 };

  requireAuth(req, res, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 0);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Authentication required' });
});

test('requireAdmin calls next when user role is admin', () => {
  const req = { user: { id: 2, role: 'admin' } };
  const res = createResMock();
  const nextCalls = { count: 0 };

  requireAdmin(req, res, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('requireAdmin returns 403 when user is missing', () => {
  const req = { user: null };
  const res = createResMock();
  const nextCalls = { count: 0 };

  requireAdmin(req, res, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 0);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Admin access required' });
});

test('requireAdmin returns 403 when user role is not admin', () => {
  const req = { user: { id: 3, role: 'user' } };
  const res = createResMock();
  const nextCalls = { count: 0 };

  requireAdmin(req, res, () => {
    nextCalls.count += 1;
  });

  assert.equal(nextCalls.count, 0);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Admin access required' });
});
