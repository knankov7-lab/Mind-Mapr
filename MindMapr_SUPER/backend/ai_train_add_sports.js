const db = require("./db");

async function exampleExists(intent, input, output) {
  const row = await db.get(
    "SELECT id FROM ai_examples WHERE intent = ? AND COALESCE(input, '') = ? AND output = ? LIMIT 1",
    [String(intent), String(input ?? ""), String(output ?? "")]
  );
  return Boolean(row && row.id);
}

async function insertIfMissing(ex) {
  const intent = String(ex.intent || "").trim();
  if (!intent) throw new Error("intent required");

  const input = ex.input == null ? null : String(ex.input);
  const output = String(ex.output || "");
  if (!output.trim()) throw new Error("output required");

  const exists = await exampleExists(intent, input, output);
  if (exists) return false;

  await db.insertAiExample(intent, input, output, ex.tags ?? null);
  return true;
}

async function main() {
  await db.initDatabase();

  const examples = [
    // ===== suggest-nodes =====
    {
      intent: "suggest-nodes",
      tags: "спорт, футбол, физическо, училище",
      input: "Existing nodes:\n- Спорт\n- Футбол\n- Тренировка\n",
      output: JSON.stringify(
        [
          "Правила на играта",
          "Позиции и роли",
          "Техника и умения",
          "Тактика и стратегия",
          "Физическа подготовка",
          "Екипировка",
          "Отбор и треньор",
          "Състезания и турнири",
        ],
        null,
        0
      ),
    },
    {
      intent: "suggest-nodes",
      tags: "спорт, баскетбол, физическо, училище",
      input: "Existing nodes:\n- Баскетбол\n- Дрибъл\n- Отбор\n",
      output: JSON.stringify(
        [
          "Правила и нарушения",
          "Позиции в отбора",
          "Подавания и пасове",
          "Стрелба и техники",
          "Защита и преса",
          "Тактики в нападение",
          "Физическа подготовка",
          "Тренировки и упражнения",
        ],
        null,
        0
      ),
    },
    {
      intent: "suggest-nodes",
      tags: "спорт, бадминтон, физическо, училище",
      input: "Existing nodes:\n- Бадминтон\n- Сервис\n- Мрежа\n",
      output: JSON.stringify(
        [
          "Правила и точки",
          "Удари и техника",
          "Позициониране на корта",
          "Екипировка и ракета",
          "Тактика в играта",
          "Двойки и отборна игра",
          "Загрявка и превенция",
          "Чести грешки",
        ],
        null,
        0
      ),
    },

    // ===== generate-map =====
    {
      intent: "generate-map",
      tags: "спорт, общо, физическо, училище",
      input: "Topic: Спорт",
      output: JSON.stringify(
        [
          "Ползи за здравето",
          "Видове спортове",
          "Правила и феърплей",
          "Тренировъчен режим",
          "Хранене и хидратация",
          "Екипировка",
          "Безопасност и травми",
          "Психология и мотивация",
          "Отборна работа",
          "Състезания и постижения",
        ],
        null,
        0
      ),
    },
    {
      intent: "generate-map",
      tags: "спорт, футбол, физическо",
      input: "Topic: Футбол",
      output: JSON.stringify(
        [
          "Основни правила",
          "Позиции на играчите",
          "Тактики и формации",
          "Техника на пас",
          "Техника на удар",
          "Контрол на топката",
          "Тренировки",
          "Съдия и нарушения",
          "Турнири и първенства",
          "Феърплей",
        ],
        null,
        0
      ),
    },
    {
      intent: "generate-map",
      tags: "спорт, баскетбол, физическо",
      input: "Topic: Баскетбол",
      output: JSON.stringify(
        [
          "Основни правила",
          "Позиции в отбора",
          "Дрибъл и контрол",
          "Подавания",
          "Стрелба",
          "Защита",
          "Тактики в нападение",
          "Нарушения и фаулове",
          "Тренировки",
          "Състезания",
        ],
        null,
        0
      ),
    },
    {
      intent: "generate-map",
      tags: "спорт, бадминтон, физическо",
      input: "Topic: Бадминтон",
      output: JSON.stringify(
        [
          "Правила и точки",
          "Корт и зони",
          "Сервис",
          "Основни удари",
          "Позициониране",
          "Тактика",
          "Екипировка",
          "Загрявка",
          "Тренировки",
          "Чести грешки",
        ],
        null,
        0
      ),
    },
  ];

  let inserted = 0;
  for (const ex of examples) {
    const didInsert = await insertIfMissing(ex);
    if (didInsert) inserted += 1;
  }

  const total = await db.countAiExamples();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ inserted, total }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
