// Vercel serverless function — proxies Airtable so the PAT never reaches the browser.

export default async function handler(req, res) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const pat = process.env.AIRTABLE_PAT;

  if (!baseId || !pat) {
    return res.status(500).json({
      error: 'Missing AIRTABLE_BASE_ID or AIRTABLE_PAT environment variable.'
    });
  }

  try {
    let records = [];
    let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/Lessons`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${pat}` }
      });

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({
          error: `Airtable error ${response.status}: ${text}`
        });
      }

      const data = await response.json();
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    const activeOnly = records.filter(r => r.fields?.Active === true);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ records: activeOnly });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
