const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || '0.0.0.0'; // 监听所有网卡，供局域网访问
const VOLC_BASE_URL = (process.env.VOLC_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/,'');
const VOLC_API_KEY = process.env.VOLC_API_KEY || '';
const VOLC_MODEL = process.env.VOLC_MODEL || 'doubao-seed-1-6-vision-250815';

// 加载提示词配置
let PROMPTS = {
	base_ocr_prompt: '严格执行：仅提取图片中实际出现的文字，不增删改，不解释不润色；保持自然段与原始换行；表格按行展开，单元格以空格分隔；公式以线性文本表示。',
	translate_zh_prefix: '将以下文本忠实翻译为简体中文，不添加任何解释或注释，仅输出译文：',
	extract_questions_prefix: '从以下文本中提取题目（含编号、题干、选项、答案/解析如存在），保持原有层级与序号格式，不改写内容：'
};
try {
	const p = path.join(__dirname, 'prompts.json');
	if (fs.existsSync(p)) {
		const json = JSON.parse(fs.readFileSync(p, 'utf8'));
		PROMPTS = { ...PROMPTS, ...json };
	}
} catch (e) {
	console.warn('Load prompts.json failed, using defaults.');
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// 静态资源：直接服务当前目录
app.use(express.static(path.join(__dirname)));

// 健康检查
app.get('/health', (_req, res) => res.json({ ok: true }));

// AI 识别代理（固定火山引擎 Ark）
app.post('/api/ai/ocr', upload.none(), async (req, res) => {
	try {
		if (!VOLC_API_KEY) return res.status(400).json({ error: 'Server missing VOLC_API_KEY' });
		const { imageDataUrl } = req.body || {};
		if (!imageDataUrl) return res.status(400).json({ error: 'Missing imageDataUrl' });
		const body = {
			model: VOLC_MODEL,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'image_url', image_url: { url: imageDataUrl } },
						{ type: 'text', text: PROMPTS.base_ocr_prompt }
					]
				}
			]
		};
		const resp = await fetch(`${VOLC_BASE_URL}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${VOLC_API_KEY}`
			},
			body: JSON.stringify(body)
		});
		const text = await resp.text();
		if (!resp.ok) {
			return res.status(resp.status).send(text);
		}
		const json = JSON.parse(text);
		res.json({ text: json?.choices?.[0]?.message?.content || '' });
	} catch (e) {
		console.error(e);
		res.status(500).json({ error: 'AI proxy failed', detail: String(e?.message || e) });
	}
});

// AI 文本后处理：翻译/题目抽取
app.post('/api/ai/post', upload.none(), async (req, res) => {
	try {
		if (!VOLC_API_KEY) return res.status(400).json({ error: 'Server missing VOLC_API_KEY' });
		const { task, text } = req.body || {};
		if (!text) return res.status(400).json({ error: 'Missing text' });
		let instruction = '';
		if (task === 'translate_zh') {
			instruction = PROMPTS.translate_zh_prefix;
		} else if (task === 'extract_questions') {
			instruction = PROMPTS.extract_questions_prefix;
		} else {
			return res.status(400).json({ error: 'Unknown task' });
		}
		const body = {
			model: VOLC_MODEL,
			messages: [
				{ role: 'user', content: [{ type: 'text', text: `${instruction}\n\n${text}` }] }
			]
		};
		const resp = await fetch(`${VOLC_BASE_URL}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${VOLC_API_KEY}`
			},
			body: JSON.stringify(body)
		});
		const t = await resp.text();
		if (!resp.ok) return res.status(resp.status).send(t);
		const json = JSON.parse(t);
		return res.json({ text: json?.choices?.[0]?.message?.content || '' });
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: 'AI postprocess failed', detail: String(e?.message || e) });
	}
});

// 单页应用兜底
app.get('*', (req, res, next) => {
	if (req.path.startsWith('/api/')) return next();
	res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
	console.log(`Server running at http://${HOST}:${PORT}`);
});


