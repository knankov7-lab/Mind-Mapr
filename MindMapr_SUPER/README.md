# MindMapr SUPER (Интерактивен + Екипна работа)

## Стартиране

### 1) Backend
```bash
cd backend
npm install
npm start
```

### 2) Frontend
```bash
cd ../frontend-react
npm install
npm start
```

## Какво е реализирано

### Карта и редактиране
- Drag&Drop възли
- Свързване на възли (edges)
- Избор и изтриване на възли/връзки
- Преименуване на възли (F2)
- Контекстно меню за форма и цвят на възел
- Zoom/Pan + MiniMap
- Режим „Завършена карта"

### Realtime колаборация
- WebSocket стаи (`room`)
- Присъствие (online participants)
- Live курсори на участници
- Чат в стаята
- Коментари по карта/възел
- Прозорец "Room Guests" с активни участници

### Достъп и роли в стая
- Join request flow за частни стаи
- Одобрение/отказ на заявки от ръководител на стаята (owner) или admin
- Роли в стая: `viewer`, `editor`, `owner`
- Управление на гости от UI (owner/admin):
	- смяна `viewer`/`editor`
	- премахване от room members

### Запис и версии
- Запис/зареждане на карта
- История на версии и възстановяване
- Списък с карти
- Публични карти (approval flow)

### Импорт/експорт
- Export JSON
- Import JSON
- Export PNG с QR payload
- Import от изображение (QR decode)

### Onboarding и UX
- Разширен tutorial за първи вход (multi-step)
- Повторно отваряне на tutorial от Профил
- Room Guests секция в sidebar

### Админ модел (role + permissions)
- Роли: `ops-admin`, `super-admin`, `admin` (legacy)
- Permission-based guard за admin API
- Различни права по endpoint вместо един глобален флаг
- Role management от AdminPanel (users.manage)
- Role Audit tab за следене на role-change събития

## Админ акаунти

### Създаване през скрипт
```bash
cd backend

# super-admin
ACCOUNT_EMAIL=super@example.com ACCOUNT_PASSWORD='StrongPass123!' ACCOUNT_USERNAME=super npm run create-super-admin

# ops-admin
ACCOUNT_EMAIL=ops@example.com ACCOUNT_PASSWORD='StrongPass123!' ACCOUNT_USERNAME=ops npm run create-ops-admin
```

### Поддържани env променливи за seed при старт
- `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_USERNAME`
- `OPS_ADMIN_EMAIL`, `OPS_ADMIN_PASSWORD`, `OPS_ADMIN_USERNAME`
- Legacy fallback: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_USERNAME`, `ADMIN_ROLE`

## Инфраструктура
- Turso (libSQL)
- Node.js + Express + WebSocket backend
- React frontend
