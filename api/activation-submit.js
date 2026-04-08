export default async function handler(req, res) {
  try {
    const response = await fetch('https://activate.xile.indevs.in/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.text();
    res.status(200).send(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}
