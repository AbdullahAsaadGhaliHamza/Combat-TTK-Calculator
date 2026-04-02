# TTK Calculator

<img width="1920" height="1080" alt="TTKCalculator" src="https://github.com/user-attachments/assets/83ec6fa5-3ced-4726-b610-136a7c0de7ed" />

A genre-agnostic Time-to-Kill calculator for game designers. Input weapon stats and enemy health pools, generate TTK heatmaps across every weapon-enemy combination, and catch balance problems before playtesting.

Works for shooters (FPS/TPS), ARPGs, and tactics/turn-based games. All three genres are handled by the same engine with different inputs.

Open `dashboard.html` in a browser. No install, no server, no build step.

---

## What's in the box

```
ttk-system/
  dashboard.html      visual calculator - open in any browser
  README.md           this file
  data/
    definitions.json  all weapon presets, enemy presets, status effects
  core/
    engine.js         damage calc, TTK simulator, heatmap generator, DPS breakdown
  tools/
    ttk.js            CLI for batch analysis and export
  examples.js         6 runnable code examples
  output/             exported files land here
```

---

## Dashboard

Open `dashboard.html` in Chrome, Firefox, or Edge.

**Left panel - weapons**

Pick a weapon preset from the dropdown and hit Add. Four weapons are loaded by default (AR, SMG, Sniper, Shotgun). Each weapon card shows a summary of its key stats. Check or uncheck to include or exclude from the heatmap. Click a card to open the full editor below.

The weapon editor lets you change every stat: damage, damage type, fire rate, mag size, reload time, pellet count, headshot multiplier, crit chance, crit multiplier, status effect and proc chance, and range falloff (none, linear, or exponential with configurable near/far/min values).

Below the weapon list are scenario controls: distance slider, crit chance bonus, damage bonus percent, status chance bonus, hit chance bonus (for tactics mode), and headshot toggle.

The heatmap mode selector switches between TTK (seconds), shots to kill, and burst DPS views.

**Enemy panel (right)**

Check any enemy to include it in the heatmap. A search box filters by name or tag. Each row shows HP and shield values at a glance.

**Heatmap tab**

A color-coded grid of every weapon vs every enemy. Green is fast, red is slow. N/K means the weapon cannot kill that enemy with default ammo before running dry. Click any cell to populate the inspector with a full damage breakdown for that matchup.

**DPS Breakdown tab**

Bar charts for every active weapon showing burst DPS, sustained DPS (accounting for reload), and DPS with status effects included. Values are computed against the first selected enemy.

**Timeline tab**

Pick a weapon and enemy to see HP and shield drain over time, plus cumulative damage dealt. Useful for spotting reload gaps and shield-breaking moments.

**Saved tab**

Save snapshots of the current scenario (weapons, enemies, distance, modifiers). Load any snapshot back. Each saved entry shows weapon count, enemy count, distance, and timestamp.

**Export**
- CSV: TTK heatmap + DPS breakdown + shots-to-kill table in one file
- JSON: full results including heatmap cells, DPS data, and metadata

---

## Weapon types covered

**Shooter:** Assault Rifle, SMG, Sniper Rifle, Shotgun, Pistol, LMG

**ARPG:** Fast Melee, Heavy Melee, Fire Staff, Bow

**Tactics:** Sword, Rifle

All presets are editable and any custom weapon can be created from scratch.

---

## Enemy presets (15 total)

Grunt, Heavy, Shield Trooper, Armored Vest, Elite, Boss (Light), Boss (Heavy), Fire Resistant, Ice Vulnerable, Phys. Resistant, Swarm Unit, Drone, Mech, Zombie, Custom

Each enemy has: HP, shield, armor value, armor type (none / flat / percent), and per-damage-type resistance multipliers.

---

## Status effects

Burn, Bleed, Poison, Shock, Freeze, Stun, Corrode. Each has DPS, duration, tick rate, and stack behavior. Bleed and Corrode stack up to their max. Corrode also shreds armor per stack.

The TTK calculator folds status damage into the deterministic simulation based on proc chance and expected total damage per application.

---

## Damage model

The calculation chain for each shot:

1. Apply range falloff multiplier (linear or exponential based on distance vs near/far values)
2. Apply pellet count multiplier
3. Apply flat damage bonus from modifiers
4. Apply crit (expected value: `base * (1 + crit_chance * (crit_mult - 1))`)
5. Apply headshot multiplier if enabled
6. Apply shield: if shield > 0, damage hits shield first with overflow into HP
7. Apply armor mitigation: flat armor subtracts from raw damage, percent armor reduces it proportionally
8. Apply elemental resistance multiplier from enemy's resistance table
9. Fold in expected status damage based on proc chance

Armor type "flat" means `effective = max(1, raw - armor)`. Armor type "percent" means `effective = raw * (1 - min(0.9, armor/100))`.

---

## Tactics mode

When fire rate is 0, the weapon uses turn-based math instead. Inputs: AP cost, base hit chance, terrain bonus. The simulator calculates expected damage per turn based on attacks per turn and hit probability, then derives turns-to-kill.

---

## CLI

Requires Node.js 14+. No npm install needed.

```bash
node tools/ttk.js --report --distance=40
node tools/ttk.js --weapons=assault_rifle,sniper --enemies=grunt,heavy,elite --csv
node tools/ttk.js --project=myproject.json --csv --json
node tools/ttk.js --list-weapons
node tools/ttk.js --list-enemies
```

**Options**

| Flag | Default | What it does |
|------|---------|--------------|
| `--weapons=a,b` | all | Comma-separated weapon preset IDs |
| `--enemies=a,b` | all | Comma-separated enemy preset IDs |
| `--distance=N` | 40 | Range in units |
| `--headshot` | off | Apply headshot multiplier |
| `--crit=N` | 0 | Crit chance bonus percent |
| `--dmg-bonus=N` | 0 | Flat damage bonus percent |
| `--project=path` | none | Load a saved project JSON |
| `--out=path` | ./output | Output directory |
| `--csv` | off | Export CSV heatmap |
| `--json` | off | Export full JSON results |
| `--report` | off | Print TTK table to console |
| `--dps` | off | Include DPS breakdown |
| `--list-weapons` | off | List all weapon preset IDs |
| `--list-enemies` | off | List all enemy preset IDs |

---

## Using it in code

```js
const { TTKSimulator, HeatmapGenerator, DPSBreakdown, DamageCalc } = require("./core/engine");
const DEFS = require("./data/definitions.json");

const weapon = { ...DEFS.weapon_classes.find(w => w.id === "assault_rifle").defaults, id: "ar", name: "AR" };
const enemy  = DEFS.enemy_presets.find(e => e.id === "heavy");
const mods   = { headshot: false, crit_chance_bonus: 0, damage_bonus: 0, status_chance_bonus: 0 };

const result = TTKSimulator.simulateDeterministic(weapon, enemy, mods, 40, DEFS.status_effects);
console.log(result.ttk + "s to kill");

const cells = HeatmapGenerator.generate([weapon], [enemy], mods, 40, DEFS.status_effects);
const normalized = HeatmapGenerator.normalize(cells, "ttk");

const dps = DPSBreakdown.analyze(weapon, enemy, mods, 40, DEFS.status_effects);
console.log("Burst DPS:", dps.dps_burst);
```

Run `node examples.js` to see all 6 examples.

---

## JSON output format

```json
{
  "meta": { "generated": "...", "distance": 40, "modifiers": {} },
  "weapons": [...],
  "enemies": [...],
  "heatmap": [
    {
      "weapon_id": "assault_rifle",
      "enemy_id": "grunt",
      "ttk": 0.4,
      "ttk_unit": "seconds",
      "killed": true,
      "shots": 3,
      "mags": 1,
      "dps_burst": 294.0,
      "dps_sustained": 147.0
    }
  ],
  "dps_breakdown": [...]
}
```

---

## Reproducibility

The deterministic simulator does not use random numbers. Same inputs always produce the same TTK values. The probabilistic simulator (used for status procs in detailed mode) uses expected-value math rather than rolling dice, so it is also deterministic.
