const path = require("path");
const { DamageCalc, TTKSimulator, HeatmapGenerator, DPSBreakdown } = require("./core/engine");

const DEFS = require("./data/definitions.json");

function buildWeapon(presetId, overrides) {
  const preset = DEFS.weapon_classes.find(w => w.id === presetId);
  if (!preset) throw new Error("Unknown weapon preset: " + presetId);
  return { ...preset.defaults, id: presetId, name: preset.name, ...overrides };
}

function buildEnemy(presetId, overrides) {
  const e = DEFS.enemy_presets.find(e => e.id === presetId);
  if (!e) throw new Error("Unknown enemy preset: " + presetId);
  return { ...e, ...overrides };
}

const NO_MODS = { headshot: false, crit_chance_bonus: 0, damage_bonus: 0, status_chance_bonus: 0, hit_chance_bonus: 0 };

function example_basic_ttk() {
  console.log("=== Example 1: Basic TTK comparison ===\n");

  const weapons = ["assault_rifle", "smg", "sniper", "shotgun", "pistol"].map(id => buildWeapon(id));
  const enemies = ["grunt", "heavy", "elite"].map(id => buildEnemy(id));
  const dist = 40;

  const nameW = 22, nameE = 16;
  console.log("  " + "Weapon".padEnd(nameW) + enemies.map(e => e.name.padStart(nameE)).join(""));
  console.log("  " + "-".repeat(nameW + enemies.length * nameE));

  for (const w of weapons) {
    const row = enemies.map(e => {
      const r = TTKSimulator.simulateDeterministic(w, e, NO_MODS, dist, DEFS.status_effects);
      if (!r.killed || r.ttk === null) return "N/K".padStart(nameE);
      return (r.ttk.toFixed(2) + "s").padStart(nameE);
    });
    console.log("  " + w.name.padEnd(nameW) + row.join(""));
  }
  console.log();
}

function example_headshot_comparison() {
  console.log("=== Example 2: Body vs headshot TTK ===\n");

  const weapons = ["assault_rifle", "sniper", "pistol"].map(id => buildWeapon(id));
  const enemy = buildEnemy("grunt");
  const dist = 30;

  console.log("  Weapon".padEnd(24) + "Body".padStart(12) + "Headshot".padStart(12) + "Improvement".padStart(14));
  console.log("  " + "-".repeat(62));

  for (const w of weapons) {
    const body = TTKSimulator.simulateDeterministic(w, enemy, { ...NO_MODS, headshot: false }, dist, DEFS.status_effects);
    const head = TTKSimulator.simulateDeterministic(w, enemy, { ...NO_MODS, headshot: true }, dist, DEFS.status_effects);
    const bodyStr = body.killed ? body.ttk.toFixed(3) + "s" : "N/K";
    const headStr = head.killed ? head.ttk.toFixed(3) + "s" : "N/K";
    const improv = (body.killed && head.killed) ? ((1 - head.ttk / body.ttk) * 100).toFixed(1) + "% faster" : "-";
    console.log("  " + w.name.padEnd(24) + bodyStr.padStart(12) + headStr.padStart(12) + improv.padStart(14));
  }
  console.log();
}

function example_range_falloff() {
  console.log("=== Example 3: Range falloff impact on TTK ===\n");

  const weapon = buildWeapon("shotgun");
  const enemy = buildEnemy("grunt");
  const distances = [5, 15, 30, 50, 80];

  console.log(`  ${weapon.name} vs ${enemy.name}\n`);
  console.log("  Distance".padEnd(14) + "Falloff%".padStart(10) + "TTK".padStart(12) + "Shots".padStart(8));
  console.log("  " + "-".repeat(44));

  for (const d of distances) {
    const r = TTKSimulator.simulateDeterministic(weapon, enemy, NO_MODS, d, DEFS.status_effects);
    const rf = weapon.range_falloff;
    const near = rf.near || 0, far = rf.far || 100, minP = rf.min_pct ?? 0.5;
    let fallPct;
    if (d <= near) fallPct = 100;
    else if (d >= far) fallPct = Math.round(minP * 100);
    else fallPct = Math.round((1 - (d - near) / (far - near) * (1 - minP)) * 100);
    const ttkStr = r.killed ? r.ttk.toFixed(3) + "s" : "N/K";
    const shots  = r.killed ? r.shots_to_kill : "-";
    console.log(`  ${(d + "u").padEnd(14)}${(fallPct + "%").padStart(10)}${ttkStr.padStart(12)}${String(shots).padStart(8)}`);
  }
  console.log();
}

function example_status_effects() {
  console.log("=== Example 4: Status effect contribution ===\n");

  const base = buildWeapon("staff_fire");
  const enemy = buildEnemy("grunt");

  const results = [
    { label: "No status",     mods: { ...NO_MODS, status_chance_bonus: -100 } },
    { label: "25% proc",      mods: { ...NO_MODS } },
    { label: "100% proc",     mods: { ...NO_MODS, status_chance_bonus: 65 } }
  ];

  console.log("  Fire Staff vs Grunt\n");
  for (const { label, mods } of results) {
    const r = TTKSimulator.simulateDeterministic(base, enemy, mods, 0, DEFS.status_effects);
    const dps = DPSBreakdown.analyze(base, enemy, mods, 0, DEFS.status_effects);
    console.log(`  ${label.padEnd(16)} TTK: ${r.killed ? r.ttk.toFixed(3) + "s" : "N/K"}  DPS: ${dps.dps_with_status.toFixed(1)}`);
  }
  console.log();
}

function example_heatmap() {
  console.log("=== Example 5: Heatmap generation ===\n");

  const weapons = ["assault_rifle", "smg", "sniper", "shotgun"].map(id => buildWeapon(id));
  const enemies = ["grunt", "heavy", "shielded", "elite"].map(id => buildEnemy(id));
  const cells = HeatmapGenerator.generate(weapons, enemies, NO_MODS, 40, DEFS.status_effects);
  const normalized = HeatmapGenerator.normalize(cells, "ttk");

  const eNames = enemies.map(e => e.name.slice(0, 10).padStart(12));
  console.log("  Weapon".padEnd(20) + eNames.join(""));
  console.log("  " + "-".repeat(20 + enemies.length * 12));

  for (const w of weapons) {
    const row = enemies.map(e => {
      const c = normalized.find(x => x.weapon_id === w.id && x.enemy_id === e.id);
      return c ? c._display.padStart(12) : "  N/K".padStart(12);
    });
    console.log("  " + w.name.slice(0, 18).padEnd(20) + row.join(""));
  }
  console.log();
}

function example_dps_breakdown() {
  console.log("=== Example 6: Full DPS breakdown ===\n");

  const weapons = ["assault_rifle", "lmg", "smg"].map(id => buildWeapon(id));
  const enemy = buildEnemy("grunt");
  const mods = { ...NO_MODS, crit_chance_bonus: 10, damage_bonus: 15 };

  console.log("  Mods: +10% crit chance, +15% damage bonus\n");
  console.log("  Weapon".padEnd(22) + "Burst".padStart(10) + "Sustained".padStart(12) + "Dmg/shot".padStart(11) + "Reload eff".padStart(12));
  console.log("  " + "-".repeat(67));

  for (const w of weapons) {
    const bd = DPSBreakdown.analyze(w, enemy, mods, 40, DEFS.status_effects);
    console.log(
      "  " + w.name.padEnd(22) +
      bd.dps_burst.toFixed(1).padStart(10) +
      bd.dps_sustained.toFixed(1).padStart(12) +
      bd.dmg_per_shot_effective.toFixed(1).padStart(11) +
      (bd.reload_efficiency * 100).toFixed(0).padStart(10) + "%"
    );
  }
  console.log();
}

example_basic_ttk();
example_headshot_comparison();
example_range_falloff();
example_status_effects();
example_heatmap();
example_dps_breakdown();
