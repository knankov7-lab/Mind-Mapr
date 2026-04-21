const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "Документация-приложения");
const outputPath = path.join(outputDir, "Приложение-Кодов-листинг.md");
const numberedOutputPath = path.join(outputDir, "Приложение-Номерирани-кодови-листинги.md");

const files = [
  { path: "backend/admin.js", lang: "javascript", title: "Backend модул за администрация" },
  { path: "backend/auth.js", lang: "javascript", title: "Backend модул за автентикация" },
  { path: "backend/db.js", lang: "javascript", title: "Backend модул за достъп до база данни" },
  { path: "backend/server.js", lang: "javascript", title: "Backend сървър и API" },
  { path: "backend/time.js", lang: "javascript", title: "Backend помощен модул за време" },
  { path: "frontend-react/src/EditorApp.js", lang: "javascript", title: "Основен React редактор" },
  { path: "frontend-react/src/AdminPanel.js", lang: "javascript", title: "Административен панел" },
  { path: "frontend-react/src/api.js", lang: "javascript", title: "Клиентски API слой" },
  { path: "frontend-react/src/App.js", lang: "javascript", title: "Коренов React компонент" },
  { path: "frontend-react/src/AuthContext.js", lang: "javascript", title: "Контекст за автентикация" },
  { path: "frontend-react/src/MapHistoryDialog.js", lang: "javascript", title: "Диалог за история на карти" },
  { path: "frontend-react/src/MapListDialog.js", lang: "javascript", title: "Диалог за списък с карти" },
  { path: "frontend-react/src/OnlineMapsPage.js", lang: "javascript", title: "Страница с онлайн карти" },
  { path: "frontend-react/src/PublicMapsPage.js", lang: "javascript", title: "Страница с публични карти" },
  { path: "frontend-react/src/index.js", lang: "javascript", title: "Входна точка на frontend приложението" },
  { path: "frontend-react/src/time.js", lang: "javascript", title: "Frontend помощен модул за време" },
  { path: "frontend-react/src/styles/app.css", lang: "css", title: "Основни стилове на приложението" },
];

function normalizeContent(content) {
  return content.replace(/\r\n/g, "\n");
}

function buildAppendix() {
  const lines = [];
  lines.push("# Приложение: Пълен програмен код на MindMapr SUPER");
  lines.push("");
  lines.push(
    "Настоящото приложение съдържа пълни кодови листинги на основните backend и frontend модули на системата. Листингите са включени в оригиналния им вид като кодови приложения към дипломния проект."
  );
  lines.push("");
  lines.push("## Съдържание на кодовите приложения");
  lines.push("");

  for (const entry of files) {
    lines.push(`- ${entry.path} - ${entry.title}`);
  }

  lines.push("");

  for (const entry of files) {
    const fullPath = path.join(rootDir, entry.path);
    const raw = fs.readFileSync(fullPath, "utf8");
    const content = normalizeContent(raw).split("\n");

    lines.push(`## ${entry.title}`);
    lines.push("");
    lines.push(`Файл: ${entry.path}`);
    lines.push("");
    lines.push(`\u0060\u0060\u0060${entry.lang}`);
    lines.push(...content);
    lines.push("\u0060\u0060\u0060");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildNumberedAppendix() {
  const lines = [];
  lines.push("# Приложение: Номерирани кодови листинги на MindMapr SUPER");
  lines.push("");
  lines.push(
    "Настоящото приложение съдържа същите основни модули на системата, но с номерирани редове за по-лесно рефериране по време на дипломна защита, обсъждане на архитектурата и анализ на конкретни реализации."
  );
  lines.push("");
  lines.push("## Съдържание на номерираните листинги");
  lines.push("");

  for (const entry of files) {
    lines.push(`- ${entry.path} - ${entry.title}`);
  }

  lines.push("");

  for (const entry of files) {
    const fullPath = path.join(rootDir, entry.path);
    const raw = fs.readFileSync(fullPath, "utf8");
    const content = normalizeContent(raw).split("\n");

    lines.push(`## ${entry.title}`);
    lines.push("");
    lines.push(`Файл: ${entry.path}`);
    lines.push("");
    lines.push("```text");
    content.forEach((line, index) => {
      const lineNumber = String(index + 1).padStart(4, "0");
      lines.push(`${lineNumber} | ${line}`);
    });
    lines.push("```");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, buildAppendix(), "utf8");
fs.writeFileSync(numberedOutputPath, buildNumberedAppendix(), "utf8");

const lineCount = fs.readFileSync(outputPath, "utf8").split(/\r?\n/).length - 1;
const numberedLineCount = fs.readFileSync(numberedOutputPath, "utf8").split(/\r?\n/).length - 1;
console.log(`Generated ${outputPath}`);
console.log(`Lines: ${lineCount}`);
console.log(`Generated ${numberedOutputPath}`);
console.log(`Lines: ${numberedLineCount}`);