# AGENTS.md — Art Engine (AI workflow)

> **Pro AI agenty (Cursor, Claude, Codex, …).**  
> Lidská specifikace: [`README.md`](./README.md).  
> Maintainer / API detaily: [`src/DEV.md`](./src/DEV.md).  
> Release: **1.0** — engine je stabilní; defaultně **neměň** runtime kód.  
> **Nesahej na `color-engine/` ani `typo-engine/`** při práci na art intentu.

---

## 0. Role agenta (jedna věta)

Jsi **orchestrátor art-direction intentu a regenerace promptu**, ne autor enginu.  
Ze screenshotů, popisu a zpětné vazby upravuješ **JSON config**, spustíš **headless generate** a zapíšeš **config + jeden art-direction prompt**.

---

## 1. Mentální model

```text
┌──────────────────────┐
│ screenshoty + popis  │  ← evidence + owner intent
└──────────┬───────────┘
           │ externí multimodální AI
           ▼
┌──────────────────────┐
│ art-config.json      │  ← jediný zdroj pravdy
└──────────┬───────────┘
           │ importEngineConfig → generateSystem
           ▼
┌──────────────────────┐
│ art-direction prompt │  ← jediný generovaný text
└──────────────────────┘
```

| Vrstva | Co to je | Smí AI měnit? |
| :--- | :--- | :--- |
| Config JSON | Persistentní estetický intent | **Ano** — při kalibraci/tuningu |
| Generovaný prompt | Výstup pro návrh, implementaci i kontrolu | **Ano** — jen přepsat generate výsledkem |
| `src/art-engine.js` | Deterministický engine | **Ne** (default) |
| `app/*` | Playground | **Ne** (default) |
| Color/typo config a tokeny | Sousední zdroje numerické pravdy | **Ne** v tomto workflow |

---

## 2. Hard boundaries

### 2.1 Smíš (default)

1. Číst a editovat `config/art-config.json`.
2. Kalibrovat config ze screenshotů a/nebo popisu podle `prompts/calibrate-config.md`.
3. Volat veřejné headless API z `src/art-engine.js`.
4. Přepsat generovaný art-direction text výsledkem `generatePrompt` / `generateSystem`.
5. Použít prompt při UI práci podle `prompts/apply-art.md`.

### 2.2 Nesmíš (bez výslovného requestu)

- Refaktorovat engine nebo playground při běžné kalibraci.
- Generovat CSS tokeny, komponenty, spacing/radius/shadow scales nebo komponentové API. Výjimkou je explicitně vyžádaný či dodaný scoped reference override u konkrétní osy.
- Kopírovat color/typo tokeny do art configu nebo měnit jejich enginy.
- Přidávat model SDK, API key nebo upload screenshotů do playgroundu.
- Ukládat obrázky/base64 do configu.
- Vytvářet zvláštní generation/review prompty; jeden prompt slouží pro oba účely.

### 2.3 Kdy smíš sáhnout na engine

Jen když uživatel výslovně požádá o bugfix nebo novou funkci enginu. Pak: reprodukce → `src/DEV.md` → minimální změna → roundtrip a prompt smoke test.

---

## 3. Kanonický workflow

### Krok A — Orientace

1. Přečti aktuální `config/art-config.json`.
2. Urči uživatelský intent podle §5: **Calibrate**, **Tune**, **Generate** nebo **Apply**.
3. Při Calibrate přečti celý `prompts/calibrate-config.md`; při Apply přečti `prompts/apply-art.md`.

### Krok B — Intent → config

- **Calibrate:** analyzuj všechny přiložené screenshoty a popis jako jednu sadu evidence; aktualizuj celý relevantní config.
- **Tune:** změň nejmenší relevantní vrstvu; nepřepisuj vše kvůli jedné větě.
- **Generate/Apply:** config neměň.

### Krok C — Regenerace (povinná po změně configu)

```js
import { importEngineConfig, generateSystem } from './src/art-engine.js';

const state = importEngineConfig(configJson);
const { config, prompt } = generateSystem(state);

// Zapiš OBOJÍ:
// 1) config → art-config.json
// 2) prompt → dohodnutý art-direction.md / prompt soubor
```

### Krok D — Verifikace

- [ ] Config je validní JSON a projde importem.
- [ ] Každá osa má `name`, hodnotu 0–100 a oba konkrétní póly.
- [ ] Každý `axes[].snippets[]` má neprázdný kód, patří k dané dimenzi a není vydáván za globální tokenový systém.
- [ ] Pravidla jsou pozorovatelná, akční a neodporují si.
- [ ] Prompt obsahuje všechny aktivní dimenze a pravidla.
- [ ] Prompt nevytváří paralelní color/typo/token systém.
- [ ] Config i prompt na disku odpovídají poslední změně.

---

## 4. Dva provozní režimy

### 4.1 Tento repozitář

| Soubor | Role |
| :--- | :--- |
| `config/art-config.json` | Projektový intent |
| `src/art-engine.js` | Headless engine |
| `prompts/calibrate-config.md` | Reference → config workflow |
| `prompts/apply-art.md` | Použití promptu při UI práci |
| `app/` | Volitelný editor/preview; není zdroj pravdy |

### 4.2 Spotřebitelský projekt

```text
consumer-project/
├── design-intent/
│   ├── art-config.json
│   └── art-direction.md
└── (sdílený Art Engine — nekopíruj jeho logiku)
```

Agent upravuje config, spustí sdílený engine, přepíše prompt a při UI práci prompt načte. Pokud cesta k enginu nebo výstupnímu promptu chybí, zeptej se; nevymýšlej fork.

---

## 5. Intent mapování (požadavek → workflow)

| Požadavek uživatele (příklady) | Workflow | Akce |
| :--- | :--- | :--- |
| „Ze screenshotů udělej art config“, „calibrate art profile“ | **Calibrate** | `prompts/calibrate-config.md` → celý normalizovaný config → generate |
| „Použij screeny i tento popis“ | **Calibrate** | screenshot = evidence, text = owner intent; konflikt řeš dle calibrate promptu |
| „Je to moc měkké / card-heavy / marketingové“ | **Tune** | uprav nejmenší relevantní osu/rule/antiRule/heuristic → generate |
| „Vygeneruj/aktualizuj art prompt“ | **Generate** | config neměň; spusť generate a zapiš prompt |
| „Navrhni/implementuj UI podle art direction“ | **Apply** | načti generovaný prompt + `prompts/apply-art.md`; config neměň |
| „Zkontroluj tento návrh proti art direction“ | **Apply** | stejný prompt; uveď konkrétní drift a minimální opravy |

### 5.1 Co editovat při Tune

| Zpětná vazba | Config vrstva |
| :--- | :--- |
| Kontinuální charakter („méně hravé“) | relevantní `axes[].value` |
| Nový pojmenovaný kontinuální rozměr | přidej/edituj `axes[]` |
| Konkrétní canonical implementace dimenze | `axes[].snippets[]` jako scoped reference override |
| Obecný princip | `rules[]` |
| Konkrétní nežádoucí drift | `antiRules[]` |
| Preference mezi dvěma validními cestami | `heuristics[]` |
| Celková identita se změnila | `styleProfile` |

---

## 6. Allowlist API

- `createDefaultState`
- `importEngineConfig` / `exportEngineConfig`
- `generatePrompt` / `generateSystem`
- `normalizeAxes`
- `normalizeAxisSnippet` / `normalizeAxisSnippets`
- `assignUniqueAxisName`
- `clampAxisValue`
- `sanitizeId`
- `MAX_AXIS_SNIPPETS`

Nepřepisuj normalizaci nebo prompt ručně v agentním workflow.

---

## 7. Invarianty

1. **Config = intent, prompt = výstup.**
2. Po změně configu vždy regenerate.
3. Stejný canonical config = stejný prompt.
4. Osy jsou volné a editovatelné; výchozí dimenze v configu nejsou povinný registr.
5. Každá osa musí mít explicitní význam obou pólů.
6. Volitelné snippety patří pouze ke své ose; `note` omezuje scope a kód není univerzální komponenta.
7. Číslo osy není token ani pokyn použít jeden motiv všude.
8. Jeden prompt slouží pro návrh, implementaci i kontrolu.
9. Color a typo zůstávají oddělené numerické zdroje pravdy.
10. Playground není zdroj pravdy; soubor configu ano.

---

## 8. Sharp edges

- Prázdné/osamocené názvy se při importu sanitizují; persistuj `config` z generate.
- Duplicitní názvy os dostanou deterministické suffixy (`Name-2`, `Name-3`).
- Chybějící póly dostanou obecný fallback; při kalibraci je vždy nahraď konkrétním významem.
- Snippet bez kódu se při normalizaci odstraní; nevymýšlej snippet jen ze screenshotu bez explicitního požadavku.
- Na jedné ose je max 8 override snippetů (`MAX_AXIS_SNIPPETS`).
- Silně překrývající se osy rozmělňují prompt; raději méně nezávislých dimenzí.
- Screenshot ukazuje realizaci, text může vyjadřovat záměr změny; nezaměňuj je.
- Playground nepersistuje změny automaticky na disk — explicitně stáhni config. Refresh stránky znovu načte `art-config.json`.

---

## 9. Anti-patterns

| Špatně | Správně |
| :--- | :--- |
| Z jednoho card layoutu vytvořit globální pravidlo | Hledej opakovaný důkaz nebo použij konkrétní anti-rule |
| Vymyslet 12 synonymních os | Nech 3–7 nezávislých dimenzí |
| Ručně upravit generovaný prompt | Změň config → generate |
| Vytvořit review/generation varianty | Použij jeden prompt s kontextem aktuálního úkolu |
| Přenést hexy/font sizes do art configu | Použij Color/Typo Engine |

---

## 10. Minimální příkazy

Repo nemá povinný CLI/build systém. Headless happy path je ESM import. Pokud trvalý regen skript neexistuje, nevytvářej ho jako produkt bez výslovné žádosti.

Playground servíruj přes HTTP tak, aby mohl načíst `../config/art-config.json`.

---

## 11. Jak odpovídat uživateli

1. Shrň rozpoznaný intent (Calibrate/Tune/Generate/Apply).
2. Při změně uveď, které config vrstvy se změnily.
3. Proveď normalizaci + generate + zápis.
4. Stručně potvrď výsledný profil/dimenze a cestu promptu.
5. Nezahlcuj uživatele interními variantami promptů.

---

## 12. Escalační matice

| Situace | Akce |
| :--- | :--- |
| Chybí screenshot i konkrétní popis | Vyžádej reference nebo intent |
| Screenshoty si odporují | Zachyť stabilní průnik, sniž confidence, nevytvářej průměrný generic profil |
| Text chce záměrně jiný směr než screenshot | Respektuj text jako owner intent a zachovej screenshot jako evidence |
| Nejasná cesta k promptu ve spotřebiteli | Zeptej se |
| Potřeba tokenů/komponent | Mimo scope; přesměruj na správnou vrstvu |
| Podezření na bug enginu | Repro + `src/DEV.md`; kód měň jen s povolením |

---

## 13. Rychlá karta (TL;DR)

```text
1. Recognize: Calibrate / Tune / Generate / Apply
2. Calibrate/Tune → edit art-config.json
3. importEngineConfig → generateSystem
4. Write normalized config + one art-direction prompt
5. Apply the same prompt for creation and review
6. Do not touch engine/app/color/typo without explicit request
```

---

*Art Engine 1.0 — AI orchestration contract. Engine code is frozen unless the user explicitly requests engine changes.*
