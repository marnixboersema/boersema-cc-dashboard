# Boersema CC Foundations Dashboard

'n Eenvoudige iPad-vriendelike dashboard wat CC Foundations memory work, video's, audio en werkkaarte op een plek konsolideer. Inhoud word in Airtable bestuur; die front-end is vanilla HTML/CSS/JS gehost op Vercel.

## Argitektuur

```
[Airtable basis]  →  [Vercel serverless proxy]  →  [Vanilla JS dashboard]  →  [iPad Safari]
```

- Geen build-stap, geen npm install, geen framework
- Een statiese front-end (`index.html` + `style.css` + `app.js`)
- Een serverless funksie (`api/lessons.js`) wat Airtable se PAT bewaak
- Airtable PAT word **nooit** aan die browser blootgestel nie

## 1. Airtable-basis opstel

Skep 'n nuwe basis genaamd `Boersema CC Foundations`. Voeg 'n tabel `Lessons` met die volgende velde by:

| Veldnaam | Tipe | Notas |
|---|---|---|
| `ID` | Formula | `"C" & {Cycle} & "W" & {Week} & "-" & {Subject}` |
| `Cycle` | Number (integer) | 1, 2, 3 |
| `Week` | Number (integer) | 1–24 |
| `Subject` | Single Select | `History`, `Science`, `English Grammar`, `Latin`, `Math`, `Geography`, `Timeline`, `Fine Arts` |
| `Memory Work` | Long text | |
| `Memory Work (Afrikaans)` | Long text | |
| `CC Connected URL` | URL | |
| `CC Connected Title` | Single line text | |
| `YouTube URLs` | Long text | Een URL per reël |
| `Audio Files` | Attachment (meervoudig) | MP3's |
| `PDFs` | Attachment (meervoudig) | Werkkaarte, kleurprente |
| `Notes` | Long text | Privaat — wys nie op dashboard nie |
| `Active` | Checkbox | Merk die week wat tans bestudeer word |

> **Belangrik**: die `Subject`-opsies se name moet presies ooreenstem met die lys hierbo (hoofletters en spelling), anders kry die kaart geen inhoud nie.

### Aanbevole views

- **`Active Week`** — Filter `Active = TRUE`
- **`Cycle 2 Overzicht`** — Filter `Cycle = 2`, gegroepeer by `Week`
- **`All Lessons`** — Geen filter, vir bulk-redigering

## 2. Airtable-token kry

1. Gaan na <https://airtable.com/create/tokens>
2. Skep 'n Personal Access Token met:
   - Scope: **`data.records:read`** (read-only)
   - Access: net die `Boersema CC Foundations`-basis
3. Kopieer die token (begin met `pat...`)

Kry ook die basis-ID:

1. Gaan na <https://airtable.com/api>
2. Kies jou basis
3. Die basis-ID staan boaan en begin met `app...`

## 3. Lokaal toets (opsioneel)

Vir lokale toets met die Vercel-proxy:

```bash
npm install -g vercel
cd boersema-cc-dashboard
cp .env.example .env
# vul AIRTABLE_PAT en AIRTABLE_BASE_ID in
vercel dev
```

Dit hardloop op `http://localhost:3000`.

> Sonder `vercel dev` kan jy steeds `index.html` direk in 'n browser oopmaak, maar `/api/lessons` sal misluk omdat die serverless funksie nie gehoor word nie.

## 4. Deploy na Vercel

1. Skep 'n GitHub-repo en push die kode:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:USERNAME/boersema-cc-dashboard.git
   git push -u origin main
   ```
2. Gaan na <https://vercel.com/new> en importeer die repo
3. Vercel sal die statiese front-end en `api/`-funksie outomaties opspoor
4. By **Environment Variables**, voeg in:
   - `AIRTABLE_PAT` — jou PAT
   - `AIRTABLE_BASE_ID` — jou basis-ID
5. Klik **Deploy**

Na deployment kry jy 'n URL soos `boersema-cc-dashboard.vercel.app`. Voeg gerus 'n eie domein by (bv. `skool.boersema.co.za`) onder Vercel se "Domains"-paneel.

## 5. Inhoud byvoeg

1. Maak Airtable oop
2. Voeg 'n nuwe ry by met die regte `Cycle`, `Week`, en `Subject`
3. Vul die memory work, video-URL's, en heg MP3's of PDF's aan
4. Stoor — die dashboard wys nuwe inhoud binne ~1 minuut (cache-tyd)

Om die "huidige week" te verander, merk die `Active`-vinkblokkie op die regte ry.

## Lêerstruktuur

```
boersema-cc-dashboard/
├── api/
│   └── lessons.js      # Vercel serverless proxy na Airtable
├── index.html
├── style.css
├── app.js
├── vercel.json
├── .env.example
├── .gitignore
└── README.md
```

## Probleemoplossing

- **"Fout met laai van data"** — Kontroleer die Vercel-omgewing-veranderlikes en dat die PAT toegang tot die basis het.
- **Vakkaart bly grys ("ghost")** — Daar's geen ry vir daardie `Cycle`/`Week`/`Subject`-kombinasie nie. Skep een in Airtable.
- **Audio speel nie op iPad nie** — iOS Safari vereis 'n gebruiker-aksie (tap) voor audio kan begin. Dit is normaal; die kind tap die ▶-knoppie.
- **YouTube embed werk nie** — Nie alle video's laat embed toe nie. Probeer 'n alternatiewe URL.
