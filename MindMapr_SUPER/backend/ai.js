// AI module for MindMapr
// Goal: useful, safe suggestions with predictable output.
// "Training" here means: curated few-shot examples stored in SQLite (ai_examples) + a stable prompt.

const { HfInference } = require("@huggingface/inference");
const { listAiExamples } = require("./db");

const hfApiKey = process.env.HUGGINGFACE_API_KEY;
const hf = hfApiKey ? new HfInference({ apiKey: hfApiKey }) : null;

function getNodeLabels(nodes) {
  const safe = Array.isArray(nodes) ? nodes : [];
  return safe
    .map((n) => (n && n.data && n.data.label != null ? String(n.data.label) : ""))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
}

function normalizeWords(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}0-9]+/u)
    .filter((w) => w && w.length >= 3)
    .slice(0, 300);
}

function scoreOverlap(queryWords, candidateText) {
  const cand = new Set(normalizeWords(candidateText));
  let score = 0;
  for (const w of queryWords) {
    if (cand.has(w)) score += 1;
  }
  return score;
}

async function bestExampleJsonArray(intent, queryText) {
  const examples = await listAiExamples(intent, 25);
  if (!examples.length) return null;

  const q = normalizeWords(queryText);
  const scored = examples
    .map((ex) => {
      const hay = [ex.intent, ex.tags, ex.input].filter(Boolean).join("\n");
      return { ex, score: scoreOverlap(q, hay) };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) return null;

  try {
    const parsed = JSON.parse(String(best.ex.output || "").trim());
    if (!Array.isArray(parsed)) return null;
    return parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return null;
  }
}

async function buildFewShot(intent) {
  const examples = await listAiExamples(intent, 8);
  return examples
    .map((ex) => {
      const inp = ex.input ? String(ex.input).slice(0, 2000) : "";
      const out = String(ex.output || "").slice(0, 2000);
      return `### Example\nInput:\n${inp}\n\nOutput:\n${out}`;
    })
    .join("\n\n");
}

async function callHfTextGeneration(prompt) {
  if (!hf) return null;
  // Prefer a smaller, widely available instruct model to reduce failures.
  // If the model is not available for your key/account, this will be caught and we fall back.
  const result = await hf.textGeneration({
    model: process.env.HF_TEXT_MODEL || "HuggingFaceH4/zephyr-7b-beta",
    inputs: prompt,
    parameters: { max_new_tokens: 220, temperature: 0.5, return_full_text: false },
  });
  return result?.generated_text ? String(result.generated_text) : null;
}

// Generate keyword suggestions from node labels (no external calls by default)
async function suggestKeywords(nodes) {
  const labels = getNodeLabels(nodes);
  const words = normalizeWords(labels.join(" "));
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

// Suggest new nodes based on existing ideas
async function suggestNewNodes(nodes) {
  const labels = getNodeLabels(nodes);
  const input = labels.map((s) => `- ${s}`).join("\n");

  // Offline/always-available path: use best matching stored example if any
  try {
    const exArr = await bestExampleJsonArray("suggest-nodes", labels.join(" \n"));
    if (exArr && exArr.length) {
      const existing = new Set(labels.map((x) => x.toLowerCase()));
      return exArr
        .filter((x) => !existing.has(x.toLowerCase()))
        .slice(0, 12);
    }
  } catch {
    // ignore
  }

  // Try HF with few-shot examples; otherwise deterministic fallback
  try {
    const fewShot = await buildFewShot("suggest-nodes");
    const prompt = [
      "You are an assistant for creating mind maps in Bulgarian.",
      "Task: Suggest 6-10 NEW node titles that complement the existing nodes.",
      "Rules:",
      "- Output ONLY a JSON array of strings.",
      "- Each string: 2-6 words, Bulgarian, no punctuation at end.",
      "- Avoid duplicates of existing node titles.",
      fewShot ? `\n${fewShot}\n` : "",
      "Existing nodes:",
      input,
      "\nOutput:",
    ].join("\n");

    const gen = await callHfTextGeneration(prompt);
    if (gen) {
      const parsed = JSON.parse(gen.trim());
      if (Array.isArray(parsed)) {
        const existing = new Set(labels.map((x) => x.toLowerCase()));
        return parsed
          .map((x) => String(x).trim())
          .filter(Boolean)
          .filter((x) => !existing.has(x.toLowerCase()))
          .slice(0, 12);
      }
    }
  } catch (_e) {
    // fall back
  }

  // Fallback: simple heuristic suggestions
  const base = labels[0] || "Тема";
  const suggestions = [
    `Въведение към ${base}`,
    `Ключови понятия за ${base}`,
    `Примери и приложения`,
    `Причини и фактори`,
    `Ефекти и последици`,
    `Рискове и проблеми`,
    `Решения и стратегии`,
    `План за действие`,
  ];
  const existing = new Set(labels.map((x) => x.toLowerCase()));
  return suggestions.filter((x) => !existing.has(x.toLowerCase())).slice(0, 10);
}

// Example: Propose links between nodes for better structure
function proposeLinks(nodes) {
  // Placeholder: simple logic, connect nodes with similar keywords
  const links = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].data.label.split(' ').some(word => nodes[j].data.label.includes(word))) {
        links.push({ source: nodes[i].id, target: nodes[j].id });
      }
    }
  }
  return links;
}

// Example: Analyze team activity and suggest optimizations
function analyzeActivity(activityLog) {
  // Placeholder: return mock suggestions
  return ['Добавете повече идеи', 'Свържете ключови възли', 'Разпределете задачите'];
}

module.exports = {
  suggestKeywords,
  suggestNewNodes,
  proposeLinks,
  analyzeActivity,
  // Generate mind map from topic
  async generateMindMap(topic) {
    const safeTopic = String(topic || "").trim();
    if (!safeTopic) return { nodes: [], edges: [] };

    // Offline/always-available: if we have a matching example, use it.
    try {
      const exArr = await bestExampleJsonArray("generate-map", safeTopic);
      if (exArr && exArr.length) {
        const nodes = [
          { id: "root", data: { label: safeTopic }, position: { x: 0, y: 0 }, type: "default" },
        ];
        const edges = [];
        let idx = 1;
        for (const label of exArr.slice(0, 14)) {
          nodes.push({
            id: `n${idx}`,
            data: { label },
            position: { x: 180 + (idx % 4) * 220, y: -180 + Math.floor(idx / 4) * 140 },
            type: "default",
          });
          edges.push({ id: `e-root-n${idx}`, source: "root", target: `n${idx}` });
          idx++;
        }
        return { nodes, edges };
      }
    } catch {
      // ignore
    }

    // Try HF generation with few-shot examples; otherwise deterministic structure.
    try {
      const fewShot = await buildFewShot("generate-map");
      const prompt = [
        "You are an assistant that generates mind maps in Bulgarian.",
        "Task: Create 8-12 subtopics for the given topic.",
        "Rules:",
        "- Output ONLY a JSON array of strings.",
        "- Each string: 2-6 words, Bulgarian.",
        fewShot ? `\n${fewShot}\n` : "",
        `Topic: ${safeTopic}`,
        "\nOutput:",
      ].join("\n");

      const gen = await callHfTextGeneration(prompt);
      if (gen) {
        const arr = JSON.parse(gen.trim());
        if (Array.isArray(arr) && arr.length) {
          const nodes = [
            { id: "root", data: { label: safeTopic }, position: { x: 0, y: 0 }, type: "default" },
          ];
          const edges = [];
          let idx = 1;
          for (const item of arr.slice(0, 14)) {
            const label = String(item).trim();
            if (!label) continue;
            nodes.push({
              id: `n${idx}`,
              data: { label },
              position: { x: 180 + (idx % 4) * 220, y: -180 + Math.floor(idx / 4) * 140 },
              type: "default",
            });
            edges.push({ id: `e-root-n${idx}`, source: "root", target: `n${idx}` });
            idx++;
          }
          return { nodes, edges };
        }
      }
    } catch (_e) {
      // fall back
    }

    const defaults = [
      "Определение",
      "Основни понятия",
      "Причини",
      "Последици",
      "Примери",
      "Предимства",
      "Недостатъци",
      "Решения",
      "План",
    ];
    const nodes = [{ id: "root", data: { label: safeTopic }, position: { x: 0, y: 0 }, type: "default" }];
    const edges = [];
    let idx = 1;
    for (const label of defaults) {
      nodes.push({ id: `n${idx}`, data: { label }, position: { x: 200 + (idx % 3) * 220, y: -160 + Math.floor(idx / 3) * 140 }, type: "default" });
      edges.push({ id: `e-root-n${idx}`, source: "root", target: `n${idx}` });
      idx++;
    }
    return { nodes, edges };
  }
};
