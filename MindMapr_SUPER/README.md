# MindMapr SUPER (Интерактивен + Екипна работа)

## 1) Стартирай backend
```bash
cd backend
npm install
npm start
```

## 2) Стартирай frontend
```bash
cd ../frontend-react
npm install
npm start
```

## Екипна работа
- Отвори приложението и избери `room` (напр. `team1`)
- Натисни **Копирай линк** и го изпрати на колеги
- Всички в една и съща стая редактират картата в реално време

## Основни функции
- Drag&Drop възли
- Свързване на възли (edge)
- Zoom/Pan + MiniMap
- Realtime колаборация (WebSocket)
- История на версиите и възстановяване
- Коментари, чат и присъствие на участници
- Административен панел и публични карти
- Export/Import в JSON и PNG с QR код

## Hosting
- Turso - libSQL база данни
- Render - Node.js + Express + WebSocket backend
- Vercel - React frontend
