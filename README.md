# Boersema CC Foundations Dashboard

'n Eenvoudige iPad-vriendelike dashboard wat CC Foundations memory work, video's, audio en werkkaarte op een plek konsolideer. Inhoud word in Airtable bestuur; die front-end is vanilla HTML/CSS/JS gehost op Vercel.

## Argitektuur

```
[Besoeker]  →  [middleware.js: wagwoord-slot]  →  [Vanilla JS dashboard]
                                                          ↑
                    [Airtable basis]  →  [Vercel serverless proxy (api/lessons.js)]
```

- Geen build-stap, geen framework
- Een statiese front-end (`index.html` + `style.css` + `app.js`)
- Een serverless funksie (`api/lessons.js`) wat Airtable se PAT bewaak
- Airtable PAT word **nooit** aan die browser blootgestel nie
- 'n Edge-middleware (`middleware.js`) sluit die **hele** webwerf agter een gedeelde wagwoord
- Een klein afhanklikheid (`@vercel/functions`) word deur Vercel outomaties geïnstalleer

## Toegang: wagwoord-slot

Die hele dashboard sit agter **een gedeelde wagwoord** (geen gebruikersnaam). Enigeen
met die wagwoord kan dit oor die internet gebruik; sonder die wagwoord word **niks**
gewys nie — nie die bladsy, die kode, óf die Airtable-data nie.

Hoe dit werk:

- `middleware.js` loop op Vercel se rand **voor elke versoek** (statiese lêers én `/api/*`).
- Sonder 'n geldige sessie-koekie wys dit die aanmeldbladsy (of `401` vir die API).
- Die wagwoord lewe **net** in die `DASHBOARD_PASSWORD`-omgewingsveranderlike op Vercel —
  dit word nooit in die kode gestoor of na die browser gestuur nie.
- Ná korrekte aanmelding word 'n ondertekende, `HttpOnly`/`Secure`-koekie gestel wat
  30 dae hou. Die handtekening gebruik die wagwoord as sleutel, so wanneer jy die
  wagwoord verander, word **alle** bestaande sessies dadelik ongeldig.

### Wagwoord stel of verander

1. Gaan na jou Vercel-projek → **Settings → Environment Variables**.
2. Stel (of redigeer) `DASHBOARD_PASSWORD` na die wagwoord wat jy wil hê.
3. Klik **Redeploy** (of `git push`) sodat die nuwe waarde in werking tree.

> As `DASHBOARD_PASSWORD` ontbreek, weier die middleware **alle** toegang (faal-toe),
> sodat die dashboard nooit per ongeluk oop is nie.

Om handmatig af te meld: gaan na `/logout`.

## 1. Airtable-basis opstel

Skep 'n nuwe basis genaamd `Boersema CC Foundations`. Voeg 'n tabel `Lessons` met die volgende velde by:

| Veldnaam | Tipe | Notas |
|---|---|---|
| `ID` | Formula | `"C" & {Cycle} & "W" & {Week} & "-" & {Subject}` |
| `Cycle` | Number (integer) | 1, 2, 3 |
| `Week` | Number (integer) | 1–24 |
| `Subject` | Single Select | `History`, `Science`, `English Grammar`, `Latin`, `Math`, `Geography`, `Timeline`, `Fine Arts`, `Bible` |
| `Memory Work` | Long text | |
| `Memory Work (Afrikaans)` | Long text | Opsioneel — leeg vir Engels-alleen |
| `CC Connected URL` | URL | |
| `CC Connected Title` | Single line text | |
| `YouTube URLs` | Long text | Een URL per reël |
| `Intro Audio` | Attachment (meervoudig) | Kort intro-oudio (speaker-knoppie op subject-bladsy) |
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
   - `DASHBOARD_PASSWORD` — die gedeelde wagwoord wat die dashboard sluit
5. Klik **Deploy**

Na deployment kry jy 'n URL soos `boersema-cc-dashboard.vercel.app`. Voeg gerus 'n eie domein by (bv. `skool.boersema.co.za`) onder Vercel se "Domains"-paneel.

## 5. Inhoud byvoeg

### Handmatig (vir 'n enkele veld of regstelling)

1. Maak Airtable oop
2. Voeg 'n nuwe ry by met die regte `Cycle`, `Week`, en `Subject`
3. Vul die memory work, video-URL's, en heg MP3's of PDF's aan
4. Stoor — die dashboard wys nuwe inhoud binne ~1 minuut (cache-tyd)

Om die "huidige week" te verander, merk die `Active`-vinkblokkie op die regte ry.

### Outomaties via die `cc-ingest`-skill (vir 'n hele week)

Daar's 'n Claude Code-skill by [.claude/skills/cc-ingest/](.claude/skills/cc-ingest/) wat 'n hele week se inhoud van Google Drive na Airtable verwerk.

**Werkstroom:**

1. Clarinda gooi alles vir die week in 'n Google Drive-folder soos `CC Inbox/C2W12/`:
   - Sandbox-tydskrif PDF (heel, ongesplit)
   - Foto/scan van die CC Foundations Guide-bladsy vir daardie week
   - Audio-files (MP3/M4A/WAV) per vak
   - Optioneel: `intro.mp3` (algemeen) of `intro-history.mp3` (per vak)
2. In Claude Code in hierdie repo: *"verwerk C2W12"*
3. Die skill:
   - Klassifiseer files in die folder
   - Split die Sandbox-PDF per vak (met die `pdf`-skill)
   - Onttrek memory work-Q+A uit die Guide-bladsy
   - Soek CC Connected URLs op in [data/ccconnected-urls.csv](.claude/skills/cc-ingest/data/ccconnected-urls.csv)
   - Pas audio-files toe by die regte vakke
   - Laai alles op na Airtable via die `uploadAttachment`-eindpunt
   - Rapporteer wat opgelaai, oorgeslaan, of ontbreek het

**Vereistes:**

- `.env` met `AIRTABLE_PAT` (met `data.records:write` scope) en `AIRTABLE_BASE_ID`
- Google Drive MCP gekoppel in Claude Code
- `data/ccconnected-urls.csv` gevul met die week se URLs (eens-per-siklus werk)

Die skill **oorskryf nie** bestaande Airtable-velde nie — vra eksplisiet "vervang" indien jy dit wil doen.

## Lêerstruktuur

```
boersema-cc-dashboard/
├── api/
│   └── lessons.js                # Vercel serverless proxy na Airtable
├── lib/
│   └── auth.js                   # Sessie-token logika (Web Crypto, geen geheime in die lêer)
├── middleware.js                 # Wagwoord-slot voor elke versoek
├── .claude/skills/cc-ingest/     # Skill vir Drive → Airtable ingestion
│   ├── SKILL.md
│   ├── scripts/airtable-upload.mjs
│   └── data/ccconnected-urls.csv
├── index.html
├── style.css
├── app.js
├── vercel.json
├── package.json        # "type": module + @vercel/functions
├── .env.example
├── .gitignore
└── README.md
```

## Probleemoplossing

- **"Fout met laai van data"** — Kontroleer die Vercel-omgewing-veranderlikes en dat die PAT toegang tot die basis het.
- **Vakkaart bly grys ("ghost")** — Daar's geen ry vir daardie `Cycle`/`Week`/`Subject`-kombinasie nie. Skep een in Airtable.
- **Audio speel nie op iPad nie** — iOS Safari vereis 'n gebruiker-aksie (tap) voor audio kan begin. Dit is normaal; die kind tap die ▶-knoppie.
- **YouTube embed werk nie** — Nie alle video's laat embed toe nie. Probeer 'n alternatiewe URL.
