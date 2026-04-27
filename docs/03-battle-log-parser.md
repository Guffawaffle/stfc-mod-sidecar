# Battle-Log Parser

The v0 parser is deliberately conservative. It accepts plain text lines, preserves raw input, and emits structured fields only when the text is explicit enough.

## Parser Rules

- Preserve every source line in `rawLine`.
- Emit `phase: "unknown"` and `parseStatus: "unparsed"` for lines it cannot classify.
- Prefer `parseStatus: "partial"` over guessing when only labels such as `battleId` are known.
- Extract `battleId`, `round`, `playerShip`, `enemy`, and damage values only from explicit labels or simple battle-log wording.
- Do not infer ship names, player names, enemy classes, mitigation math, or outcome from vague text.
- Keep parser output stable enough for timeline storage and tests.

## Current API

The core package exposes:

- `parseBattleLogLine(line, options)`
- `parseBattleLogText(text, options)`

Both return normalized `battle.event` objects.

## Known Gaps

The sample logs in this scaffold are placeholders. We need real STFC battle-log text before making the parser more specific.

Questions real samples should answer:

- Does STFC expose stable battle IDs in text logs, or only in structured sync payloads?
- How are rounds delimited?
- Are critical hits and mitigation represented as separate lines or modifiers on damage lines?
- Do logs identify player ship, enemy ship, hull, level, alliance, or player names consistently?
- How do victory, defeat, draw, retreat, and timeout outcomes appear?
- Are timestamps present per line, per battle, or only in surrounding files?

## Extension Strategy

Add parser rules only after collecting real samples. Each new rule should include tests that prove unrecognized lines remain preserved instead of being guessed into false structure.
