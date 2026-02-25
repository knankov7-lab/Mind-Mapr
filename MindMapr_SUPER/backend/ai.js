// AI module for MindMapr
// Features: node suggestions, link proposals, team activity analysis, NLP integration

const { HfInference } = require('@huggingface/inference');
const hfApiKey = process.env.HUGGINGFACE_API_KEY;
const hf = new HfInference({ apiKey: hfApiKey });

// Example: Generate keyword suggestions from node labels
async function suggestKeywords(nodes) {
  const text = nodes.map(n => n.data.label).join('. ');
  const result = await hf.featureExtraction({ model: 'sentence-transformers/all-MiniLM-L6-v2', inputs: text });
  // Placeholder: return top keywords (mock)
  return text.split(' ').slice(0, 5);
}

// Example: Suggest new nodes based on existing ideas
async function suggestNewNodes(nodes) {
  const text = nodes.map(n => n.data.label).join('. ');
  // Placeholder: use HuggingFace summarization or generation
  const result = await hf.textGeneration({ model: 'facebook/bart-large-cnn', inputs: text });
  return result.generated_text.split('.').map(s => s.trim()).filter(Boolean);
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
    // Use HuggingFace text generation to get subtopics
    const result = await hf.textGeneration({ model: 'facebook/bart-large-cnn', inputs: `Generate a mind map for the topic: ${topic}. List main ideas and subtopics as bullet points.` });
    // Parse generated text into nodes and edges
    const lines = result.generated_text.split('\n').map(l => l.trim()).filter(Boolean);
    const nodes = [{ id: 'root', data: { label: topic }, position: { x: 0, y: 0 }, type: 'default' }];
    const edges = [];
    let idx = 1;
    for (const line of lines) {
      if (line.startsWith('-') || line.startsWith('*')) {
        const label = line.replace(/^[-*]\s*/, '');
        nodes.push({ id: `n${idx}`, data: { label }, position: { x: idx * 60, y: idx * 40 }, type: 'default' });
        edges.push({ id: `e-root-n${idx}`, source: 'root', target: `n${idx}` });
        idx++;
      }
    }
    return { nodes, edges };
  }
};
