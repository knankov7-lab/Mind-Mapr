# MindMapr Backend (Express + WebSocket)

## Стартиране
```bash
npm install
npm start
```

- REST API: http://localhost:3000/api/health
- WebSocket: ws://localhost:3000/ws

## Админ роли и права

### Роли
- `ops-admin`
- `super-admin`
- `admin` (legacy; backward-compatible)

### Permission model
- Достъпът до `/api/admin/*` е role + permission базиран.
- Някои ключови permissions:
	- `users.read`
	- `users.manage`
	- `rooms.read`
	- `rooms.approve`
	- `rooms.delete`
	- `logs.read`
	- `stats.read`
	- `settings.read`
	- `settings.write`

## Създаване на admin-level акаунти

```bash
npm run create-super-admin
npm run create-ops-admin
```

или с конкретни credentials:

```bash
ACCOUNT_EMAIL=super@example.com ACCOUNT_PASSWORD='StrongPass123!' ACCOUNT_USERNAME=super npm run create-super-admin
ACCOUNT_EMAIL=ops@example.com ACCOUNT_PASSWORD='StrongPass123!' ACCOUNT_USERNAME=ops npm run create-ops-admin
```

## Seed env променливи
- `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_USERNAME`
- `OPS_ADMIN_EMAIL`, `OPS_ADMIN_PASSWORD`, `OPS_ADMIN_USERNAME`
- Legacy: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_ROLE`

## Бележка
Състоянието на стаите е в паметта (in-memory) за демо/диплома.
Лесно се заменя с база данни (PostgreSQL/MongoDB + Redis).