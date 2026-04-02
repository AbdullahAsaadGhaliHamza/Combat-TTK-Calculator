class DamageCalc {
  static rangeFalloff(weapon, distance) {
    const rf = weapon.range_falloff;
    if (!rf || rf.type === "none") return 1.0;
    const near = rf.near || 0;
    const far  = rf.far  || 100;
    const minP = rf.min_pct ?? 0.5;
    if (distance <= near) return 1.0;
    if (distance >= far)  return minP;
    const t = (distance - near) / (far - near);
    if (rf.type === "linear")      return 1.0 - t * (1.0 - minP);
    if (rf.type === "exponential") return Math.max(minP, Math.pow(1.0 - t, 1.5) * (1.0 - minP) + minP);
    return 1.0;
  }

  static armorMitigation(rawDamage, enemy, damageType) {
    const armor    = enemy.armor || 0;
    const armorType = enemy.armor_type || "none";
    let dmg = rawDamage;

    if (armorType === "flat") {
      dmg = Math.max(1, rawDamage - armor);
    } else if (armorType === "percent") {
      dmg = rawDamage * (1 - Math.min(0.9, armor / 100));
    }

    const res = enemy.resistances || {};
    const resMult = res[damageType] !== undefined ? res[damageType] : 1.0;
    dmg *= resMult;

    return Math.max(0, dmg);
  }

  static shieldDamage(rawDamage, enemy, damageType) {
    const shield = enemy.shield || 0;
    if (shield <= 0) return { shieldDmg: 0, hpDmg: rawDamage };
    const resMult = (enemy.shield_resistances || {})[damageType] ?? 1.0;
    const shdDmg  = rawDamage * resMult;
    const overflow = Math.max(0, shdDmg - shield);
    return { shieldDmg: Math.min(shdDmg, shield), hpDmg: overflow };
  }

  static critDamage(baseDamage, critChance, critMultiplier) {
    const chance = Math.max(0, Math.min(100, critChance)) / 100;
    return baseDamage * (1 + chance * (critMultiplier - 1));
  }

  static statusDps(statusId, statusDefs, stacks) {
    const s = statusDefs[statusId];
    if (!s) return 0;
    const stackMult = s.stacks ? Math.min(stacks || 1, s.max_stacks || 1) : 1;
    return s.dps * stackMult;
  }

  static statusTotalDamage(statusId, statusDefs, stacks) {
    const s = statusDefs[statusId];
    if (!s) return 0;
    const stackMult = s.stacks ? Math.min(stacks || 1, s.max_stacks || 1) : 1;
    return s.dps * s.duration * stackMult;
  }

  static effectiveDamagePerShot(weapon, enemy, modifiers, distance, statusDefs) {
    const distMult = DamageCalc.rangeFalloff(weapon, distance);
    const pellets  = weapon.pellets || 1;

    let rawDmg = weapon.damage * pellets * distMult;

    rawDmg *= (1 + (modifiers.damage_bonus || 0) / 100);

    const critChance = (weapon.crit_chance || 0) + (modifiers.crit_chance_bonus || 0);
    const critMult   = (weapon.crit_multiplier || 1.5) * (1 + (modifiers.crit_mult_bonus || 0) / 100);
    rawDmg = DamageCalc.critDamage(rawDmg, critChance, critMult);

    if (modifiers.headshot) rawDmg *= (weapon.headshot_multiplier || 1.0);

    const shdResult = DamageCalc.shieldDamage(rawDmg, enemy, weapon.damage_type);
    const hpDmg = DamageCalc.armorMitigation(shdResult.hpDmg, enemy, weapon.damage_type);

    return {
      raw:          rawDmg,
      shield_dmg:   shdResult.shieldDmg,
      hp_dmg:       hpDmg,
      total_hp_dmg: hpDmg,
      dist_mult:    distMult,
      crit_included: true
    };
  }
}

class TTKSimulator {
  static simulate(weapon, enemy, modifiers, distance, statusDefs, opts = {}) {
    const maxTime      = opts.maxTime      || 60;
    const simStepMs    = opts.simStepMs    || 10;
    const reloadOnEmpty = opts.reloadOnEmpty ?? true;

    const isMelee = (weapon.mag_size === 0);
    const isTactics = (weapon.fire_rate === 0);

    if (isTactics) return TTKSimulator.simulateTactics(weapon, enemy, modifiers, distance, statusDefs);

    const fireIntervalMs = isMelee ? (60000 / weapon.fire_rate) : (60000 / weapon.fire_rate);
    const reloadMs = (weapon.reload_time || 0) * 1000;
    const magSize  = isMelee ? Infinity : (weapon.mag_size || Infinity);

    let time          = 0;
    let currentShield = enemy.shield || 0;
    let currentHp     = enemy.hp;
    let currentMag    = isMelee ? Infinity : magSize;
    let nextFireTime  = 0;
    let reloadingUntil = 0;
    let statusStacks  = 0;
    let lastStatusTime = 0;
    const statusId    = weapon.status_effect;
    const statusChance = (weapon.status_chance || 0) + (modifiers.status_chance_bonus || 0);
    const shots       = [];

    while (time <= maxTime * 1000 && currentHp > 0) {
      if (time >= nextFireTime && time >= reloadingUntil) {
        if (currentMag <= 0 && reloadOnEmpty && !isMelee) {
          reloadingUntil = time + reloadMs;
          currentMag = magSize;
        } else {
          const result = DamageCalc.effectiveDamagePerShot(weapon, { ...enemy, shield: currentShield, hp: currentHp }, modifiers, distance, statusDefs);

          if (currentShield > 0) {
            currentShield = Math.max(0, currentShield - result.shield_dmg);
            currentHp = Math.max(0, currentHp - result.hp_dmg);
          } else {
            currentHp = Math.max(0, currentHp - result.total_hp_dmg);
          }

          if (statusId && statusDefs[statusId] && Math.random() * 100 < statusChance) {
            if (statusDefs[statusId].stacks) statusStacks = Math.min(statusStacks + 1, statusDefs[statusId].max_stacks || 1);
            else statusStacks = 1;
          }

          if (!isMelee) currentMag--;
          shots.push({ time, hp_after: currentHp, shield_after: currentShield, dmg: result.total_hp_dmg + result.shield_dmg });
          nextFireTime = time + fireIntervalMs;
        }
      }

      if (statusStacks > 0 && statusId && statusDefs[statusId]) {
        const s = statusDefs[statusId];
        const tickMs = s.tick_rate * 1000;
        if (time - lastStatusTime >= tickMs) {
          const tickDmg = DamageCalc.statusDps(statusId, statusDefs, statusStacks) * s.tick_rate;
          currentHp = Math.max(0, currentHp - tickDmg);
          lastStatusTime = time;
        }
      }

      if (currentHp <= 0) break;
      time += simStepMs;
    }

    const ttk = currentHp <= 0 ? shots[shots.length - 1]?.time / 1000 : null;
    const shotsUsed = shots.length;
    const magsFired = isMelee ? 0 : Math.ceil(shotsUsed / magSize);

    const fireRate = weapon.fire_rate;
    const rps = fireRate / 60;
    const dmgPerShot = DamageCalc.effectiveDamagePerShot(weapon, enemy, modifiers, distance, statusDefs);
    const dps_raw = dmgPerShot.total_hp_dmg * rps;
    const dps_sustained = isMelee ? dps_raw : dps_raw * (magSize / (magSize + rps * (weapon.reload_time || 0)));

    return {
      ttk,
      ttk_ms: ttk !== null ? ttk * 1000 : null,
      killed: currentHp <= 0,
      shots_to_kill: ttk !== null ? shotsUsed : null,
      mags_required: magsFired,
      dps_burst: dps_raw,
      dps_sustained,
      hp_remaining: currentHp,
      shield_remaining: currentShield,
      status_stacks_at_kill: statusStacks,
      timeline: shots.slice(0, 200)
    };
  }

  static simulateTactics(weapon, enemy, modifiers, distance, statusDefs) {
    const hitChanceBase = (weapon.hit_chance_base || 75) + (modifiers.hit_chance_bonus || 0) + (modifiers.terrain_bonus || 0);
    const hitChance = Math.max(5, Math.min(99, hitChanceBase)) / 100;
    const apCost = weapon.ap_cost || 2;
    const apPerTurn = modifiers.ap_per_turn || 4;
    const attacksPerTurn = Math.floor(apPerTurn / apCost);

    const dmgResult = DamageCalc.effectiveDamagePerShot(weapon, enemy, modifiers, distance, statusDefs);
    const avgDmgPerHit = dmgResult.total_hp_dmg;
    const avgDmgPerAttack = avgDmgPerHit * hitChance;

    let turns = 0;
    let hpRemaining = enemy.hp + (enemy.shield || 0);
    let turnsNeeded = 0;

    while (hpRemaining > 0 && turns < 100) {
      turns++;
      for (let a = 0; a < attacksPerTurn; a++) {
        hpRemaining -= avgDmgPerAttack;
        if (hpRemaining <= 0) break;
      }
      if (hpRemaining <= 0) turnsNeeded = turns;
    }

    const killProbPerAttack = hitChance;
    const expectedHitsToKill = (enemy.hp + (enemy.shield || 0)) / avgDmgPerHit;
    const expectedAttacksToKill = expectedHitsToKill / hitChance;

    return {
      ttk: turnsNeeded || null,
      ttk_unit: "turns",
      killed: hpRemaining <= 0,
      turns_to_kill: turnsNeeded || null,
      attacks_to_kill: Math.ceil(expectedAttacksToKill),
      hit_chance: hitChance * 100,
      avg_dmg_per_attack: avgDmgPerAttack,
      dps_burst: avgDmgPerAttack * attacksPerTurn,
      dps_sustained: avgDmgPerAttack * attacksPerTurn,
      hp_remaining: Math.max(0, hpRemaining),
      shield_remaining: 0,
      timeline: []
    };
  }

  static simulateDeterministic(weapon, enemy, modifiers, distance, statusDefs) {
    const isTactics = weapon.fire_rate === 0;
    if (isTactics) return TTKSimulator.simulateTactics(weapon, enemy, modifiers, distance, statusDefs);

    const isMelee = weapon.mag_size === 0;
    const rps = weapon.fire_rate / 60;
    const magSize = isMelee ? Infinity : weapon.mag_size;
    const reloadTime = weapon.reload_time || 0;

    const dmgResult = DamageCalc.effectiveDamagePerShot(weapon, enemy, modifiers, distance, statusDefs);
    const dmgPerShot = dmgResult.total_hp_dmg;
    const dmgPerShieldShot = dmgResult.shield_dmg;

    let shieldHp = enemy.shield || 0;
    let hp = enemy.hp;
    let totalTime = 0;
    let shotCount = 0;
    let currentMag = isMelee ? Infinity : magSize;
    const statusId = weapon.status_effect;
    const statusChance = (weapon.status_chance || 0) + (modifiers.status_chance_bonus || 0);
    const statusDef = statusId ? statusDefs[statusId] : null;
    const expectedStatusDmg = statusDef
      ? (statusChance / 100) * DamageCalc.statusTotalDamage(statusId, statusDefs, 1)
      : 0;

    while (hp > 0 && shotCount < 10000) {
      if (!isMelee && currentMag <= 0) {
        totalTime += reloadTime;
        currentMag = magSize;
      }

      if (shieldHp > 0) {
        const shdTaken = Math.min(dmgResult.shield_dmg || dmgPerShot, shieldHp);
        shieldHp -= shdTaken;
        const overflow = dmgResult.hp_dmg || 0;
        hp -= overflow;
      } else {
        hp -= dmgPerShot;
        hp -= expectedStatusDmg;
      }

      shotCount++;
      if (!isMelee) currentMag--;
      totalTime += 1 / rps;
    }

    const dps_burst = dmgPerShot * rps;
    const dps_sustained = isMelee ? dps_burst : dps_burst * (magSize / (magSize + rps * reloadTime));

    return {
      ttk: hp <= 0 ? Math.max(0, totalTime) : null,
      ttk_ms: hp <= 0 ? Math.max(0, totalTime) * 1000 : null,
      killed: hp <= 0,
      shots_to_kill: hp <= 0 ? shotCount : null,
      mags_required: isMelee ? 0 : Math.ceil(shotCount / magSize),
      dps_burst,
      dps_sustained,
      hp_remaining: Math.max(0, hp),
      shield_remaining: Math.max(0, shieldHp),
      timeline: []
    };
  }
}

class HeatmapGenerator {
  static generate(weapons, enemies, modifiers, distance, statusDefs, mode = "ttk") {
    const cells = [];
    for (const weapon of weapons) {
      for (const enemy of enemies) {
        const result = TTKSimulator.simulateDeterministic(weapon, enemy, modifiers, distance, statusDefs);
        cells.push({
          weapon_id: weapon.id,
          weapon_name: weapon.name,
          enemy_id: enemy.id,
          enemy_name: enemy.name,
          ttk: result.ttk,
          ttk_ms: result.ttk_ms,
          killed: result.killed,
          shots_to_kill: result.shots_to_kill,
          mags_required: result.mags_required,
          dps_burst: result.dps_burst,
          dps_sustained: result.dps_sustained,
          turns_to_kill: result.turns_to_kill,
          hp_remaining: result.hp_remaining
        });
      }
    }
    return cells;
  }

  static normalize(cells, mode) {
    const vals = cells.map(c => {
      if (mode === "ttk")  return c.ttk;
      if (mode === "dps")  return c.dps_burst;
      if (mode === "shots") return c.shots_to_kill;
      return c.ttk;
    }).filter(v => v !== null && isFinite(v));

    if (vals.length === 0) return cells.map(c => ({ ...c, _norm: 0, _display: "N/A" }));

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;

    return cells.map(c => {
      let val;
      if (mode === "ttk")  val = c.ttk;
      if (mode === "dps")  val = c.dps_burst;
      if (mode === "shots") val = c.shots_to_kill;

      if (val === null || !isFinite(val)) return { ...c, _norm: -1, _display: "---" };

      const norm = (val - min) / range;
      const display = mode === "ttk"
        ? (val < 60 ? val.toFixed(2) + "s" : "60s+")
        : mode === "dps"
        ? val.toFixed(0)
        : val.toFixed(0);

      return { ...c, _norm: norm, _display: display };
    });
  }

  static toCSV(cells, weapons, enemies) {
    const weaponIds = [...new Set(cells.map(c => c.weapon_id))];
    const enemyIds  = [...new Set(cells.map(c => c.enemy_id))];

    const header = ["Weapon \\ Enemy", ...enemyIds.map(id => {
      const e = enemies.find(e => e.id === id);
      return e ? e.name : id;
    })].join(",");

    const rows = weaponIds.map(wId => {
      const wName = (weapons.find(w => w.id === wId) || {}).name || wId;
      const vals = enemyIds.map(eId => {
        const cell = cells.find(c => c.weapon_id === wId && c.enemy_id === eId);
        if (!cell || cell.ttk === null) return "N/A";
        return cell.ttk.toFixed(3);
      });
      return [wName, ...vals].join(",");
    });

    const dpsRows = weaponIds.map(wId => {
      const wName = (weapons.find(w => w.id === wId) || {}).name || wId;
      const vals = enemyIds.map(eId => {
        const cell = cells.find(c => c.weapon_id === wId && c.enemy_id === eId);
        return cell ? cell.dps_burst.toFixed(1) : "0";
      });
      return [wName + " (DPS)", ...vals].join(",");
    });

    return [
      "TTK (seconds)",
      header,
      ...rows,
      "",
      "DPS (burst)",
      header,
      ...dpsRows
    ].join("\n");
  }
}

class DPSBreakdown {
  static analyze(weapon, enemy, modifiers, distance, statusDefs) {
    const dmg = DamageCalc.effectiveDamagePerShot(weapon, enemy, modifiers, distance, statusDefs);
    const rps = weapon.fire_rate > 0 ? weapon.fire_rate / 60 : 1;
    const magSize = weapon.mag_size || Infinity;
    const reloadTime = weapon.reload_time || 0;

    const statusId = weapon.status_effect;
    const statusChance = (weapon.status_chance || 0) + (modifiers.status_chance_bonus || 0);
    const statusDef = statusId ? statusDefs[statusId] : null;
    const statusDmgPerApplication = statusDef
      ? DamageCalc.statusTotalDamage(statusId, statusDefs, 1)
      : 0;
    const expectedStatusDpsContribution = statusDef
      ? (statusChance / 100) * statusDmgPerApplication / statusDef.duration
      : 0;

    const dps_base = dmg.total_hp_dmg * rps;
    const dps_burst = dps_base;
    const dps_sustained = weapon.mag_size > 0
      ? dps_base * (magSize / (magSize + rps * reloadTime))
      : dps_base;
    const dps_with_status = dps_sustained + expectedStatusDpsContribution;

    const critChance = Math.max(0, Math.min(100, (weapon.crit_chance || 0) + (modifiers.crit_chance_bonus || 0))) / 100;
    const critMult = weapon.crit_multiplier || 1.5;
    const dps_no_crit = dmg.total_hp_dmg / (1 + critChance * (critMult - 1)) * rps;

    return {
      weapon_id: weapon.id,
      weapon_name: weapon.name,
      enemy_id: enemy.id,
      enemy_name: enemy.name,
      dmg_per_shot_raw: dmg.raw,
      dmg_per_shot_effective: dmg.total_hp_dmg,
      shield_dmg_per_shot: dmg.shield_dmg,
      dist_multiplier: dmg.dist_mult,
      dps_base_no_crit: dps_no_crit,
      dps_burst,
      dps_sustained,
      dps_with_status,
      status_contribution_dps: expectedStatusDpsContribution,
      status_proc_chance: statusChance,
      reload_efficiency: weapon.mag_size > 0 ? magSize / (magSize + rps * reloadTime) : 1,
      shots_per_mag: weapon.mag_size || null,
      fire_rate: weapon.fire_rate,
      effective_armor_reduction: Math.max(0, 1 - dmg.total_hp_dmg / Math.max(1, dmg.raw))
    };
  }
}

if (typeof module !== "undefined") {
  module.exports = { DamageCalc, TTKSimulator, HeatmapGenerator, DPSBreakdown };
}
