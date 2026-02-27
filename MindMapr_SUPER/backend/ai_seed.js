const { countAiExamples, insertAiExample } = require("./db");

async function seedAiExamplesIfEmpty() {
  const cnt = await countAiExamples();
  if (cnt > 0) return { seeded: 0, skipped: true };

  const examples = [
    {
      intent: "suggest-nodes",
      tags: "училище, екология",
      input: "Existing nodes:\n- Екология\n- Замърсяване\n- Климат\n",
      output: JSON.stringify(
        [
          "Причини за замърсяване",
          "Последици за здравето",
          "Мерки за намаляване",
          "Рециклиране и повторна употреба",
          "Възобновяема енергия",
          "Лични навици и избори",
          "Закони и контрол",
          "Образование и кампании",
        ],
        null,
        0
      ),
    },
    {
      intent: "suggest-nodes",
      tags: "история, училище",
      input: "Existing nodes:\n- Българско възраждане\n- Паисий\n- Будители\n",
      output: JSON.stringify(
        [
          "Периоди и хронология",
          "Култура и образование",
          "Църковна борба",
          "Национално самосъзнание",
          "Ключови личности",
          "Революционни организации",
          "Печат и книжнина",
          "Причини и предпоставки",
        ],
        null,
        0
      ),
    },
    {
      intent: "suggest-nodes",
      tags: "технологии, киберсигурност",
      input: "Existing nodes:\n- Киберсигурност\n- Пароли\n- Фишинг\n",
      output: JSON.stringify(
        [
          "Двуфакторна автентикация",
          "Управление на пароли",
          "Социално инженерство",
          "Зловреден софтуер",
          "Архивиране и възстановяване",
          "Сигурност на устройства",
          "Обучение на потребители",
          "Политики и процедури",
        ],
        null,
        0
      ),
    },
    {
      intent: "generate-map",
      tags: "училище, биология",
      input: "Topic: Фотосинтеза",
      output: JSON.stringify(
        [
          "Определение",
          "Къде протича",
          "Необходими условия",
          "Суровини",
          "Продукти",
          "Светлинна фаза",
          "Тъмнинна фаза",
          "Значение за екосистеми",
          "Фактори влияещи на скоростта",
          "Примери и приложения",
        ],
        null,
        0
      ),
    },
    {
      intent: "generate-map",
      tags: "история, училище",
      input: "Topic: Френска революция",
      output: JSON.stringify(
        [
          "Причини",
          "Социални групи",
          "Ключови събития",
          "Декларация за права",
          "Якобинци и жирондинци",
          "Робеспиер",
          "Терор",
          "Резултати",
          "Влияние върху Европа",
          "Хронология",
        ],
        null,
        0
      ),
    },
    {
      intent: "generate-map",
      tags: "бизнес, предприемачество",
      input: "Topic: Бизнес план",
      output: JSON.stringify(
        [
          "Идея и цел",
          "Пазар и конкуренти",
          "Целева аудитория",
          "Продукт или услуга",
          "Маркетинг стратегия",
          "Оперативен план",
          "Екип и роли",
          "Финансови прогнози",
          "Рискове",
          "План за действие",
        ],
        null,
        0
      ),
    },
  ];

  for (const ex of examples) {
    await insertAiExample(ex.intent, ex.input, ex.output, ex.tags);
  }

  return { seeded: examples.length, skipped: false };
}

module.exports = { seedAiExamplesIfEmpty };
