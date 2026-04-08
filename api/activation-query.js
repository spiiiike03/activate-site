export default async function handler(req, res) {
  try {
    const response = await fetch('https://activate.xile.indevs.in/api/public/activation-query', {  // 这里改成原网站的查询接口
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}
