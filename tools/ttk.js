#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { TTKSimulator, HeatmapGenerator, DPSBreakdown } = require("../core/engine");

const DEFS = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/definitions.json"), "utf8"));

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      args[key] = val !== undefined ? val : true;
    }
  }
  return args;
}

function printUsage() {
  console.log(`
TTK Calculator - CLI

Usage:
  node tools/ttk.js [options]

Options:
  --weapons=a,b,c    Weapon IDs to include (default: all)
  --enemies=a,b,c    Enemy IDs to include (default: all)
  --distance=N       Range in units (default: 40)
  --headshot         Apply headshot multiplier
  --crit=N           Crit chance override (0-100)
  --dmg-bonus=N      Flat damage bonus percent
  --project=path     Load saved project JSON
  --out=path         Output directory (default: ./output)
  --csv              Export CSV heatmap
  --json             Export full JSON results
  --report           Print TTK report to console
  --dps              Include DPS breakdown
  --list-weapons     List all weapon IDs
  --list-enemies     List all enemy IDs

Examples:
  node tools/ttk.js --report --distance=40
  node tools/ttk.js --weapons=assault_rifle,sniper --enemies=grunt,heavy,elite --csv
  node tools/ttk.js --project=myproject.json --csv --json
`);
}

function buildWeaponList(ids) {
  const all = DEFS.weapon_classes;
  if (!ids) return all;
  return ids.split(",").map(id => all.find(w => w.id === id.trim())).filter(Boolean).map(w => ({
    ...w.defaults, id: w.id, name: w.name
  }));
}

function buildEnemyList(ids) {
  const all = DEFS.enemy_presets;
  if (!ids) return all;
  return ids.split(",").map(id => all.find(e => e.id === id.trim())).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) { printUsage(); return; }

  if (args["list-weapons"]) {
    console.log("\nWeapon IDs:\n");
    for (const w of DEFS.weapon_classes) {
      console.log(`  ${w.id.padEnd(20)} ${w.name.padEnd(20)} [${w.genre}]`);
    }
    console.log();
    return;
  }

  if (args["list-enemies"]) {
    console.log("\nEnemy IDs:\n");
    for (const e of DEFS.enemy_presets) {
      console.log(`  ${e.id.padEnd(20)} ${e.name.padEnd(22)} HP:${String(e.hp).padStart(5)}  Shield:${String(e.shield).padStart(4)}  Armor:${String(e.armor).padStart(4)}`);
    }
    console.log();
    return;
  }

  const outDir = args.out || path.join(__dirname, "../output");
  fs.mkdirSync(outDir, { recursive: true });

  const distance = parseFloat(args.distance || 40);
  const modifiers = {
    headshot: !!args.headshot,
    crit_chance_bonus: parseFloat(args.crit || 0),
    damage_bonus: parseFloat(args["dmg-bonus"] || 0),
    status_chance_bonus: 0
  };

  let weapons, enemies;

  if (args.project) {
    const proj = JSON.parse(fs.readFileSync(args.project, "utf8"));
    weapons = proj.weapons || buildWeaponList(args.weapons).map(w => ({ ...w.defaults, id: w.id, name: w.name }));
    enemies = proj.enemies || buildEnemyList(args.enemies);
    Object.assign(modifiers, proj.modifiers || {});
  } else {
    weapons = buildWeaponList(args.weapons).map(w => ({ ...w.defaults, id: w.id, name: w.name }));
    enemies = buildEnemyList(args.enemies);
  }

  console.log(`\nTTK Calculator`);
  console.log(`  Weapons : ${weapons.length}`);
  console.log(`  Enemies : ${enemies.length}`);
  console.log(`  Distance: ${distance} units`);
  if (modifiers.headshot) console.log(`  Mode    : headshot`);
  console.log();

  const cells = HeatmapGenerator.generate(weapons, enemies, modifiers, distance, DEFS.status_effects);

  if (args.report) {
    const enemyNames = enemies.map(e => e.name.slice(0, 10).padStart(10));
    console.log("  Weapon".padEnd(22) + enemyNames.join("  "));
    console.log("  " + "-".repeat(22 + enemies.length * 12));

    for (const w of weapons) {
      const wCells = cells.filter(c => c.weapon_id === w.id);
      const vals = wCells.map(c => {
        if (!c.killed || c.ttk === null) return "  N/A      ";
        const s = c.ttk < 60 ? c.ttk.toFixed(2) + "s" : "60s+";
        return s.padStart(10) + "  ";
      });
      console.log("  " + w.name.slice(0,20).padEnd(22) + vals.join(""));
    }
    console.log();
  }

  if (args.dps) {
    console.log("  DPS Breakdown (burst / sustained):\n");
    for (const w of weapons) {
      const e0 = enemies[0];
      if (!e0) continue;
      const bd = DPSBreakdown.analyze(w, e0, modifiers, distance, DEFS.status_effects);
      console.log(`  ${w.name.padEnd(22)} burst:${bd.dps_burst.toFixed(1).padStart(8)}  sustained:${bd.dps_sustained.toFixed(1).padStart(8)}  w/status:${bd.dps_with_status.toFixed(1).padStart(8)}`);
    }
    console.log();
  }

  if (args.csv) {
    const csv = HeatmapGenerator.toCSV(cells, weapons, enemies);
    const p = path.join(outDir, `ttk_heatmap_d${distance}.csv`);
    fs.writeFileSync(p, csv);
    console.log(`CSV saved: ${p}`);
  }

  if (args.json) {
    const output = {
      meta: { distance, modifiers, generated: new Date().toISOString(), weapon_count: weapons.length, enemy_count: enemies.length },
      weapons,
      enemies,
      heatmap: cells,
      dps: args.dps ? weapons.map(w => enemies.map(e => DPSBreakdown.analyze(w, e, modifiers, distance, DEFS.status_effects))).flat() : []
    };
    const p = path.join(outDir, `ttk_results_d${distance}.json`);
    fs.writeFileSync(p, JSON.stringify(output, null, 2));
    console.log(`JSON saved: ${p}`);
  }

  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
