const express = require('express');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');

function isLegacyOverrideEnabled() {
  return String(process.env.ALLOW_LEGACY_STACK || '').trim() === '1';
}

function isProductionLikeEnvironment() {
  return (
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.RENDER) ||
    Boolean(process.env.FLY_APP_NAME) ||
    Boolean(process.env.DYNO)
  );
}

if (isProductionLikeEnvironment() && !isLegacyOverrideEnabled()) {
  throw new Error(
    'Legacy solar-route-optimizer is disabled for production-style environments. ' +
      'Use lumino-web instead, or set ALLOW_LEGACY_STACK=1 only for a deliberate short-lived override.'
  );
}

const app = express();
const PORT = process.env.PORT || 3000;

// Multer: store in memory
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Parse uploaded file → JSON array of stops ──
app.post('/api/parse', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const buf = req.file.buffer;
    const name = req.file.originalname.toLowerCase();

    let rows = [];

    if (name.endsWith('.csv') || name.endsWith('.tsv')) {
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const wb = XLSX.read(buf, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Please upload CSV or Excel.' });
    }

    if (!rows.length) return res.status(400).json({ error: 'File appears to be empty.' });

    // Detect address column
    const ADDR_HINTS = ['address', 'street', 'location', 'addr'];
    const CONTACT_HINTS = ['name', 'first', 'last', 'phone', 'cell', 'mobile', 'email', 'notes', 'comments'];

    const cols = Object.keys(rows[0]);
    const colsLower = {};
    cols.forEach(c => { colsLower[c.toLowerCase()] = c; });

    let addressCol = null;
    for (const hint of ADDR_HINTS) {
      if (colsLower[hint]) { addressCol = colsLower[hint]; break; }
    }

    // Fallback: find column with digit-rich values
    if (!addressCol) {
      for (const col of cols) {
        const samples = rows.slice(0, 5).map(r => String(r[col] || ''));
        if (samples.some(v => /\d/.test(v) && v.length > 8)) {
          addressCol = col;
          break;
        }
      }
    }

    if (!addressCol) {
      return res.status(400).json({ error: 'Could not detect address column. Please ensure your file has a column named "address" or "street".' });
    }

    const contactCols = CONTACT_HINTS.map(h => colsLower[h]).filter(Boolean);

    const stops = [];
    for (const row of rows) {
      const addr = String(row[addressCol] || '').trim();
      if (!addr || addr.toLowerCase() === 'nan' || addr === '') continue;
      const stop = { address: addr };
      for (const col of contactCols) {
        const key = col.toLowerCase();
        const val = String(row[col] || '').trim();
        if (val && val.toLowerCase() !== 'nan') stop[key] = val;
      }
      stops.push(stop);
    }

    if (!stops.length) return res.status(400).json({ error: 'No valid addresses found in file.' });

    res.json({ stops, count: stops.length, addressColumn: addressCol });
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: 'Failed to parse file: ' + err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`🚀 Do It Right Solar Route Optimizer running on port ${PORT}`));
