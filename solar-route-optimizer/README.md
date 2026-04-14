# ☀️ Do It Right Solar — Route Optimizer

A mobile-first web app for solar door-to-door sales reps. Upload a CSV or Excel lead list and get an optimized driving route with:

- 🗺️ **Optimized route** (nearest-neighbor algorithm)
- ☀️ **Solar potential** per address (Google Solar API)
- 🏠 **Property intelligence** — owner, year built, sq footage, assessed value
- 📞 **Tap-to-call** contacts
- 📍 **Street View** preview before you knock
- ✅ **Visit tracking** — Interested / Not Home / Not Interested / Callback
- 📝 **Notes** per stop
- 💬 **"Start Customer Chat"** — launches Claude with full customer context
- ✉️ **Draft follow-up text** via AI

---

## 🚀 Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/solar-route-optimizer.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) → **New Project**
2. Select **Deploy from GitHub repo**
3. Pick your `solar-route-optimizer` repo
4. Railway auto-detects Node.js and deploys — no config needed
5. Click **Generate Domain** to get your public URL

That's it! Your app is live. 🎉

---

## ⚙️ Configuration

All settings are saved in your browser's localStorage — no server config needed.

Tap the **⚙️** button after uploading a file to change:

| Setting | Default | Description |
|---|---|---|
| Starting Address | 89 South Oxford Rd, Millbury, MA 01527 | Your origin & return point |
| Google API Key | (built-in) | For Maps, Geocoding, Solar, Routes |
| Electric Rate | $0.31/kWh | Used for savings estimates |

---

## 📁 File Format

Your CSV or Excel file needs at minimum an **address column**. Column names are auto-detected.

**Supported column names:**
- Address: `address`, `street`, `location`, `addr`
- Contact: `name`, `first`, `last`, `phone`, `cell`, `mobile`, `email`, `notes`, `comments`

**Example CSV:**
```
address,name,phone
100 Main St Worcester MA,John Smith,508-555-1234
55 Park Ave Shrewsbury MA,Sarah Johnson,508-555-5678
```

---

## 🛠️ Local Development

```bash
npm install
npm run dev   # uses nodemon for auto-reload
```

App runs at `http://localhost:3000`

---

## 🏗️ Architecture

- **Backend**: Node.js + Express — handles file upload and parsing only
- **Frontend**: Single HTML file — all API calls happen in the browser
  - Google Maps Geocoding API
  - Google Solar API
  - Google Routes API
  - Anthropic API (property lookup + follow-up drafts)
- **No database** — all state is in-browser memory for the session

---

## 📦 Tech Stack

- `express` — web server
- `multer` — file upload handling
- `xlsx` — CSV and Excel parsing
- Vanilla JS frontend — no framework, works great on mobile
