# Prototypes: Contract Risk Analyst, version 10 (17 November 2026)

Three single HTML files from the same source. Open from disk. No server. State resets on reload.

| Folder | File | What it has |
|---|---|---|
| `goals_and_submissions/` | `ContextWeave_Contract_Risk_Analyst_v10_Goals_Submissions_offline.html` | **The one to demo.** Ask, Goals and Submissions |
| `goals_only/` | `ContextWeave_Contract_Risk_Analyst_v10_Goals_offline.html` | The same build with Goals in the menu and no Submissions |
| `submissions_only/` | `ContextWeave_Contract_Risk_Analyst_v10_Submissions_offline.html` | The same build with Submissions in the menu and no Goals |
| `source/` | `ContextWeave_Contract_Risk_Analyst_v10_source.zip` | The React source. `npm install`, then `bash build_all.sh` |
| `test/` | `walk_scorecard.mjs`, `walk_journeys.mjs`, `walk_settings.mjs`, `fixtures/` | The scripted walks and the Excel files they upload |
| | `checksums.json` | SHA-256 of the three HTML files |

## Address options

Add these before the `#` in the address.

| Option | What it does |
|---|---|
| `?clock=2026-11-19T14:00:00Z` | Fixes the demo clock. Use it to rehearse before the 19th |
| `?pace=0.05` | Runs the waits 20 times faster. For tests, not for the demo |

## Where things are in the source

| File | What it is |
|---|---|
| `src/data/risk.ts` | The scorecard, the 300 contracts, the readings, the scoring, the history check, the template rows, the mitigation plans |
| `src/data/askRisk.ts` | Ask: the library of 62 questions and how each kind of question is answered |
| `src/data/templateFile.ts` | Reads and writes the Excel template |
| `src/data/riskDocs.ts` | The evidence documents, web pages and mails |
| `src/data/journeyCases.ts` | The goal as typed, what the analyst reads, the questions, the workflow |
| `src/store/journeyStore.ts` | The journey: questions, upload, drafting, scoring, the morning check, and the change journey of a live goal (`parseChange`, `changeFlow`, `publishFlow`, `discardFlow`) |
| `src/store/designStore.ts` | The scorecard as the person has set it, the dashboard versions, and what a draft does to the scores against the version in force (`changeEffect`, `design.discard`) |
| `src/components/goals/ScorecardDesign.tsx` | The scorecard on the plan: edit a rule, drop or add a signal, add a factor, the history chart, the data check |
| `src/components/goals/RiskBoard.tsx` | The dashboard |
| `src/pages/GoalsJourney.tsx` | The chat and the right-hand panel; `ChangeCard` is the change plan in the chat |
| `src/pages/AskRisk.tsx` | The Ask page |
| `src/pages/SubmissionsHub.tsx` | Submissions, with the dashboard full width and in full screen |

## Running the walks

```
cd test
PLAYWRIGHT_PATH=$(npm root -g)/playwright node walk_scorecard.mjs <goals and submissions html> 1280,1440,1728
SUBS_FILE=<submissions html> PLAYWRIGHT_PATH=$(npm root -g)/playwright node walk_journeys.mjs walk_settings.mjs <goals and submissions html> 1280,1440,1728
```

On version 10: 555 checks and 363 checks, 0 failures.

## What the prototype does not do

- Nothing is connected. The data is generated in the file.
- A change request in the chat is read by its key words, like Ask. A request it cannot read gets examples.
- Ask matches a question by its key words. It is not a language model. A question it does not recognise gets "I cannot answer that yet" with suggestions.
- "Three years of history" is drawn from the current readings. There is no time series behind it.
- A signal the person adds gets generated readings.
- Rewriting a written case with no figure in it changes the wording only.
- An older version of the dashboard opens as its headline figures and its ten highest scores.
- Download in Submissions was not checked for the live dashboard.
- Sources, Data Catalog, Graph Studio, New Role and Audit show "Not part of this prototype".
