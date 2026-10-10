import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getWeather } from '../services/weather.js';

const router = Router();

// 首页天气：只要登录即可（游客也包含在内），不涉及任何服务器内部信息
router.get('/', requireAuth, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    const data = await getWeather(q.slice(0, 40));
    if (!data.ok) return res.status(502).json(data);
    return res.json(data);
  } catch {
    return res.status(502).json({ ok: false, error: '天气服务暂时不可用' });
  }
});

export default router;
