import { Plugin, UIManager, UIManagerScope, abbreviateValue } from '@highlite/core';
import { SettingsTypes, PluginSettings } from '@highlite/core';

interface Skill {
  _skill: number;
  _level: number;
  _xp: number;
}

type SkillName = string;

type OrbState = {
  root: HTMLDivElement;
  ring: HTMLDivElement;
  core: HTMLDivElement;
  icon: HTMLDivElement;
  levelBadge: HTMLDivElement;
  tooltip: HTMLDivElement;
  hoverMask: HTMLDivElement;

  totalXp: number;
  currentLevel: number;
  toNext: number;
  progress01: number;

  samples: Array<{ xp: number; t: number }>;
  fadeHandle?: number;
  lastActivityMs: number;
  removeHandle?: number;
  isFading?: boolean;

  startXp?: number;        // xp snapshot at first gain for THIS skill
  startTs?: number;        // ms timestamp when first gain happened
  emaXpPerHour?: number;   // smoothed per-skill rate
  _lastSampleXp?: number;  // last sample for EMA
  _lastSampleTs?: number;  // last sample time for EMA
};

export default class ExperienceOrbs extends Plugin {
  pluginName = 'Experience Orbs';
  author = 'Ellz';

  private uiManager!: UIManager;

  // ClientRelative container (outer) and our centered row (inner)
  private domRoot: HTMLDivElement | null = null;
  private orbsRow: HTMLDivElement | null = null;

  // Live state
  private orbs = new Map<SkillName, OrbState>();
  private prevXp = new Map<SkillName, number>();
  private cssInjected = false;

  private lastHoverKey: string | null = null;
  private onMouseMoveBound: ((e: MouseEvent) => void) | null = null;
  private onMouseLeaveBound: ((e: MouseEvent) => void) | null = null;
  private hoverRaf = 0;

    private readonly INNER_CORE_SCALE_INT = 70; // %
    private readonly RING_THICKNESS_INT   = 4;  // % of radius


  // ===== HighSpell level table (COPY YOUR FULL MAP HERE) =====
  private levelToXP: Record<number, number> = {
        1: 0,
        2: 99,
        3: 210,
        4: 333,
        5: 470,
        6: 622,
        7: 791,
        8: 978,
        9: 1185,
        10: 1414,
        11: 1667,
        12: 1947,
        13: 2256,
        14: 2598,
        15: 2976,
        16: 3393,
        17: 3854,
        18: 4363,
        19: 4925,
        20: 5546,
        21: 6232,
        22: 6989,
        23: 7825,
        24: 8749,
        25: 9769,
        26: 10896,
        27: 12141,
        28: 13516,
        29: 15035,
        30: 16713,
        31: 18567,
        32: 20616,
        33: 22880,
        34: 25382,
        35: 28147,
        36: 31202,
        37: 34579,
        38: 38311,
        39: 42436,
        40: 46996,
        41: 52037,
        42: 57609,
        43: 63769,
        44: 70579,
        45: 78108,
        46: 86433,
        47: 95637,
        48: 105814,
        49: 117067,
        50: 129510,
        51: 143269,
        52: 158484,
        53: 175309,
        54: 193915,
        55: 214491,
        56: 237246,
        57: 262410,
        58: 290240,
        59: 321018,
        60: 355057,
        61: 392703,
        62: 434338,
        63: 480386,
        64: 531315,
        65: 587643,
        66: 649943,
        67: 718848,
        68: 795059,
        69: 879351,
        70: 972582,
        71: 1075701,
        72: 1189756,
        73: 1315908,
        74: 1455440,
        75: 1609773,
        76: 1780476,
        77: 1969287,
        78: 2178128,
        79: 2409124,
        80: 2664626,
        81: 2947234,
        82: 3259825,
        83: 3605580,
        84: 3988019,
        85: 4411034,
        86: 4878932,
        87: 5396475,
        88: 5968931,
        89: 6602127,
        90: 7302510,
        91: 8077208,
        92: 8934109,
        93: 9881935,
        94: 10930335,
        95: 12089982,
        96: 13372681,
        97: 14791491,
        98: 16360855,
        99: 18096750,
        100: 20016848,
    };

  // Same emoji mapping you use elsewhere
  private skillToIcon: Record<string, string> = {
    hitpoints: '💖', accuracy: '🎯', strength: '💪', defense: '🛡️', magic: '🔮', range: '🏹',
    fishing: '🎣', mining: '⛏️', smithing: '🔨', cooking: '🍳', forestry: '🌳', crafting: '🧵',
    harvesting: '🌾', crime: '🥷', enchanting: '✨', potionmaking: '🧪',
  };

  // ===== Settings schema (Nameplates-style: text + callback) =====

  
  
private getDefaultSettings(): (Record<string, PluginSettings> & { enable: PluginSettings }) {
  return {
    enable:        { type: SettingsTypes.checkbox, text: 'Experience Orbs', value: true,
      callback: (v: boolean) => { if (!v) this.hideAllOrbs(); else this.refreshLayoutFromSettings(); } },

    showCurrentXp: { type: SettingsTypes.checkbox, text: 'Current XP',  value: true,
      callback: () => this.updateTooltipVisibility() },

    showXpToLevel: { type: SettingsTypes.checkbox, text: 'XP to Level', value: true,
      callback: () => this.updateTooltipVisibility() },

    showTimeToLevel: {
    type: SettingsTypes.checkbox,
    text: 'Time to Level',
    value: true,
    callback: () => this.updateTooltipVisibility(),
    },

    showXpHr:      { type: SettingsTypes.checkbox, text: 'XP/hr',       value: true,
      callback: () => this.updateTooltipVisibility() },

    fadeSeconds:   { type: SettingsTypes.range,    text: 'Fade (seconds)', value: 5, min: 1,  max: 20,
      callback: () => this.resetAllFadeTimers() },

/*    
ringThickness: {
  type: SettingsTypes.range,
  text: 'Outer Ring Thickness',
  value: 10,   // percent-of-radius; 10 -> 0.10
  min: 4,      // 4% .. 18%
  max: 18,
  callback: (v: number) => this.updateRingThickness(this.toNum(v, 10)),
}, */

/*
innerCoreScale: {
  type: SettingsTypes.range,
  text: 'Inner Core Scale',
  value: 82,   // percent-of-radius; 82 -> 0.82
  min: 70,
  max: 95,
  callback: (v: number) => this.updateInnerCoreScale(this.toNum(v, 82)),
}, */

orbSize: {
  type: SettingsTypes.range,
  text: 'Orb Size (px)',
  value: 56,
  min: 36,
  max: 96,
  callback: (v: number) => this.updateOrbSizes(this.toNum(v, 56)),
},

// NEW: button to reset all settings to defaults
resetDefaults: {
  type: SettingsTypes.button,
  text: 'Reset to Defaults',
  value: 'Reset',
  callback: () => this.resetSettingsToDefaults(),
},
  };
}


  // ===== Lifecycle =====

  constructor() {
   
    super();

    this.uiManager = new UIManager();
    this.settings = this.getDefaultSettings();
  }
  init(): void {

}

  start(): void {
    this.injectCssOnce();
    this.setupRoot();
    
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onMouseLeaveBound = this.onMouseLeave.bind(this);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mouseleave', this.onMouseLeaveBound);
    this.refreshLayoutFromSettings();
    this.startStatsLoop();
    this.log('Experience Orbs started');
  }

  stop(): void {
    this.orbs.forEach(o => o.root.remove());
    this.orbs.clear();
    this.prevXp.clear();
    this.cleanupRoot();
    if (this.onMouseMoveBound) window.removeEventListener('mousemove', this.onMouseMoveBound);
    if (this.onMouseLeaveBound) window.removeEventListener('mouseleave', this.onMouseLeaveBound);
    this.onMouseMoveBound = null;
    this.onMouseLeaveBound = null;
    cancelAnimationFrame(this.hoverRaf);
    this.stopStatsLoop();
    this.log('Experience Orbs stopped');
  }

  GameLoop_update(): void {
  if (!this.settings.enable.value) return;

  // hard guards
  if (!this.gameHooks || !this.gameHooks.EntityManager || !this.gameHooks.EntityManager.Instance) return;
  const main = this.gameHooks.EntityManager.Instance.MainPlayer;
  if (!main) return;

  // Normalize both sources
  const resourceSkills: Skill[] = this.normalizeSkillsBag(main.Skills ? main.Skills._skills ?? main.Skills : []);
  const combatSkills:  Skill[] = this.normalizeSkillsBag(main.Combat ? main.Combat._skills ?? main.Combat : []);

  const allSkills: Skill[] = resourceSkills.concat(combatSkills);
  if (allSkills.length === 0) return;

  const now = Date.now();
  // console.debug('[XP Orbs] skills shapes', { resLen: resourceSkills.length, cmbLen: combatSkills.length });

  for (let i = 0; i < allSkills.length; i++) {
    const s = allSkills[i];
    if (!this.isValidSkill(s)) continue;

    // Resolve a stable key/display name
    const skillNameLookup =
      (this.gameLookups && this.gameLookups['Skills'] && this.gameLookups['Skills'][s._skill]) ||
      String(s._skill);
    const skillKey: string = skillNameLookup;

    // delta detection (skip if no new XP)
    const last = this.prevXp.has(skillKey) ? this.prevXp.get(skillKey)! : s._xp;
    const delta = s._xp - last;
    this.prevXp.set(skillKey, s._xp);
    if (delta <= 0) continue;

    // ensure orb/state exists
    const orb = this.ensureOrb(skillKey);

    // level boundaries
    const curFloor  = this.levelToXP[s._level] ?? 0;
    const nextFloor = this.levelToXP[s._level + 1] ?? curFloor;
    const span = Math.max(1, nextFloor - curFloor);
    const into = Math.max(0, s._xp - curFloor);

    // update state
    orb.currentLevel = s._level;
    orb.totalXp      = s._xp;
    orb.progress01   = Math.min(1, into / span);
    orb.toNext       = Math.max(0, nextFloor - s._xp);

    // ------- PER-SKILL TIMING & EMA (starts on first gain for this skill) -------
    if (orb.startTs == null) {
      // snapshot BEFORE this tick so time/rate reflect this session of gains
      orb.startTs = now;
      orb.startXp = s._xp - Math.max(0, delta);
      // seed EMA sampling
      orb._lastSampleTs = now;
      orb._lastSampleXp = s._xp;
      orb.emaXpPerHour  = undefined;
    } else {
      // Update EMA using this event
      this.updateOrbEmaFromEvent(orb, now);
    }
    // ---------------------------------------------------------------------------

    // (Optional) keep your sample window if used elsewhere
    orb.samples.push({ xp: s._xp, t: now });
    this.gcSamples(orb, now);

    // paint + stats text + keep-alive
    this.renderOrb(orb);             // ring, level, colors, etc.
    this.renderOrbStatsFor(orb);     // uses per-skill EMA & startTs
    this.resetFade(orb, now);        // per-orb keep-alive
  }
}


  // ===== Root mounting (Nameplates pattern) =====
  private setupRoot(): void {
  this.cleanupRoot();

  // Create just our inner row; anchor to hs-screen-mask (the game viewport overlay)
  const row = document.createElement('div');
  this.orbsRow = row;
  row.id = 'highlite-xp-orbs';
  row.style.position = 'absolute';
  row.style.top = '6px';  // stays the same even if orb grows
  row.style.left = '50%';
  row.style.transform = 'translateX(-50%)';      // vertical setting
  row.style.display = 'inline-flex';         // shrink to content width
  row.style.width = 'max-content';           // ensure shrink-wrap in all browsers
  row.style.whiteSpace = 'nowrap';           // keep a single row
  row.style.gap = '8px';
  row.style.pointerEvents = 'none';          // row itself is transparent

  const mask = document.getElementById('hs-screen-mask'); // ← same anchor as XPOrb
  if (mask) mask.appendChild(row);                           // :contentReference[oaicite:7]{index=7}
  else document.body.appendChild(row);                       // fallback
}

  private cleanupRoot(): void {
    if (this.orbsRow && this.orbsRow.parentElement) this.orbsRow.parentElement.removeChild(this.orbsRow);
    if (this.domRoot && this.domRoot.parentElement) this.domRoot.parentElement.removeChild(this.domRoot);
    this.orbsRow = null;
    this.domRoot = null;
  }

  // Validate a single entry looks like a Skill
    private isValidSkill(x: any): x is { _skill: number; _level: number; _xp: number } {
        return !!x && typeof x._skill === 'number' && typeof x._level === 'number' && typeof x._xp === 'number';
    }

// Normalize various containers (array / object map / nested) into a clean Skill[]
    private normalizeSkillsBag(bag: any): Skill[] {
        if (!bag) return [];
        // If the caller hands us Skills or Combat objects, peel the _skills field if present
        const maybeArr = Array.isArray(bag) ? bag : Array.isArray(bag._skills) ? bag._skills : bag;

        if (Array.isArray(maybeArr)) {
            return maybeArr.filter((e) => this.isValidSkill(e));
        }

        // Some builds expose a dictionary object { key: Skill, ... }
        if (typeof maybeArr === 'object') {
            const out: Skill[] = [];
            for (const k in maybeArr) {
            const v = (maybeArr as any)[k];
            if (this.isValidSkill(v)) out.push(v as Skill);
            }
            return out;
        }

        return [];
    }
  private onMouseMove(e: MouseEvent): void {
  // throttle to one layout per frame
  if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
  this.hoverRaf = requestAnimationFrame(() => {
    const mx = e.clientX, my = e.clientY;
    let hoveredKey: string | null = null;

    this.orbs.forEach((orb, key) => {
      const r = orb.root.getBoundingClientRect();
      if (mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom) hoveredKey = key;
    });

    if (hoveredKey !== this.lastHoverKey) {
      if (this.lastHoverKey && this.orbs.has(this.lastHoverKey)) {
        const prev = this.orbs.get(this.lastHoverKey)!;
        prev.root.classList.remove('is-hover');
        this.resetFade(prev, Date.now()); // reset when hover ENDS
      }
      if (hoveredKey && this.orbs.has(hoveredKey)) {
        const cur = this.orbs.get(hoveredKey)!;
        cur.root.classList.add('is-hover');
        this.pauseFade(cur); // pause while hovering
      }
      this.lastHoverKey = hoveredKey;
    }
  });
}

private onMouseLeave(): void {
  if (this.lastHoverKey && this.orbs.has(this.lastHoverKey)) {
    const prev = this.orbs.get(this.lastHoverKey)!;
    prev.root.classList.remove('is-hover');
    this.resetFade(prev, Date.now());
  }
  this.lastHoverKey = null;
}

  private refreshLayoutFromSettings(): void {
  this.updateOrbSizes(this.getOrbSize());
 /* this.updateRingThickness(this.getRingThickness());
  this.updateInnerCoreScale(this.getInnerCoreScale()); */
  this.updateTooltipVisibility();
  this.resetAllFadeTimers();
  this.updateIconSizes();
}

  // ===== Orbs =====
  private ensureOrb(skillName: string): OrbState {
    if (this.orbs.has(skillName)) return this.orbs.get(skillName)!;

    const root = document.createElement('div');
    // initialize CSS vars (fractions)
    root.style.setProperty('--size', this.getOrbSize() + 'px');
    root.style.setProperty('--innerScale', String(this.getInnerCoreScale())); // 0.70
    root.style.setProperty('--thickness',  String(this.getRingThickness()));  // 0.04



// after creating `root` in ensureOrb(...)
    if ((document as any).highlite?.managers?.UIManager?.bindOnClickBlockHsMask) {
        (document as any).highlite.managers.UIManager.bindOnClickBlockHsMask(root, () => {});
    }

    root.className = 'hl-xp-orb';
    root.style.setProperty('--size', this.getOrbSizeCss());
    root.style.setProperty('--innerCoreScale', String(this.getInnerCoreScale()));
    const self = this;
    root.addEventListener('mouseenter', function () {
        root.classList.add('is-hover');
        const st = self.orbs.get(skillName);
        if (st) self.pauseFade(st);
        });
    root.addEventListener('mouseleave', function () {
        root.classList.remove('is-hover');
        const st = self.orbs.get(skillName);
        if (st) self.resetFade(st, Date.now()); // reset timer when hover ENDS
        });
    
    

    const ring = document.createElement('div');
    ring.className = 'hl-xp-orb__ring';
    ring.style.setProperty('--thickness', String(this.getRingThickness()));

    // NEW: solid inner core to eclipse the ring interior
    const core = document.createElement('div');
    core.className = 'hl-xp-orb__core';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'hl-xp-orb__iconwrap';

    const icon = document.createElement('div');
    icon.className = 'hl-xp-orb__icon';
    icon.textContent = this.skillToIcon[skillName] ?? '✨';
    // force emoji glyph to a specific px size (avoids small emoji on some stacks)
    const innerPx = Math.floor(this.getOrbSize() * this.getInnerCoreScale());
    const iconPx  = Math.floor(innerPx * 0.62); // ~62% leaves a nice rim on all platforms
    icon.style.fontSize = iconPx + 'px';



    const levelBadge = document.createElement('div');
    levelBadge.className = 'hl-xp-orb__level';
    levelBadge.textContent = '1';

    // NEW: hover mask that darkens the core on mouse-over
    const hoverMask = document.createElement('div');
    hoverMask.className = 'hl-xp-orb__mask';

    const tip = document.createElement('div');
    tip.className = 'hl-xp-orb__tip';
    tip.innerHTML = `
  <div class="hl-xp-orb__tip-header">
    <span class="tip-skill">${this.titleCase(skillName)}</span>
    <span class="tip-progress">(0.0% to Next)</span>
  </div>

  <div class="hl-xp-orb__tip-row" data-row="cur">
    <span>Current XP</span><span data-k="cur">0</span>
  </div>

  <div class="hl-xp-orb__tip-row" data-row="to">
    <span>XP to Level</span><span data-k="to">0</span>
  </div>

  <div class="hl-xp-orb__tip-row" data-row="ttl">
    <span>Time to Level</span><span data-k="ttl">NaN</span>
  </div>

  <div class="hl-xp-orb__tip-row" data-row="xphr">
    <span>XP/hr</span><span data-k="xphr">NaN</span>
  </div>
`;
    

    root.appendChild(ring);
    root.appendChild(core);
    root.appendChild(iconWrap);
    iconWrap.appendChild(icon);
    root.appendChild(hoverMask);
    root.appendChild(levelBadge);
    root.appendChild(tip);

    

    if (this.orbsRow) this.orbsRow.appendChild(root);

    const state: OrbState = {
      root, ring, core, icon, levelBadge, tooltip: tip, hoverMask,
      totalXp: 0, currentLevel: 1, toNext: 0, progress01: 0,
      samples: [],
      lastActivityMs: Date.now(),
        
    };

    // apply current settings to this new orb
    this.applyTooltipVisibility(state);

    this.orbs.set(skillName, state);
    return state;
  }

  private renderOrb(orb: OrbState): void {
  // 1) Paint ring + level
  const isMaxed = (orb.currentLevel ?? 0) >= 100;
  const prog = isMaxed ? 1 : Math.max(0, Math.min(1, orb.progress01 ?? 0));

  // ring progress + hue (red→green)
  orb.root.style.setProperty('--ringPct', String(prog));
  const hue = Math.round(120 * prog);
  orb.root.style.setProperty('--ringColor', `hsl(${hue} 60% 45%)`);

  // level text
  orb.levelBadge.textContent = String(orb.currentLevel ?? 0);

  // 2) Stats/tooltip text (uses per-skill EMA + startTs; handles NaN/maxed)
  this.renderOrbStatsFor(orb);

  // 3) Visibility rules (settings + maxed rows)
  this.applyTooltipVisibility(orb);
}


private renderOrbStatsFor(orb: OrbState): void {
  if (!orb.tooltip) return;

  const isMaxed = (orb.currentLevel ?? 0) >= 100;
  const prog = isMaxed ? 1 : Math.max(0, Math.min(1, orb.progress01 ?? 0));

  const curNode = orb.tooltip.querySelector('[data-k="cur"]')  as HTMLElement | null;
  const toNode  = orb.tooltip.querySelector('[data-k="to"]')   as HTMLElement | null;
  const hrNode  = orb.tooltip.querySelector('[data-k="xphr"]') as HTMLElement | null;
  const ttNode  = orb.tooltip.querySelector('[data-k="ttl"]')  as HTMLElement | null;
  const progHdr = orb.tooltip.querySelector('.tip-progress')   as HTMLElement | null;

  // Header: (% to Next) — remaining, not completed
  if (progHdr) progHdr.textContent = isMaxed ? 'Maxed' : `(${((1 - prog) * 100).toFixed(1)}% to Next)`;

  // Current XP
  if (curNode) curNode.textContent = abbreviateValue(orb.totalXp ?? 0);

  // XP to Level
  if (toNode) {
    const toNext = Math.max(0, Math.floor(orb.toNext ?? 0));
    toNode.textContent = isMaxed ? '' : abbreviateValue(toNext);
  }

  // XP/hr (per-skill EMA or avg since first gain)
  const xphr = this.getSkillXpPerHour(orb, Date.now());
  if (hrNode) {
    hrNode.textContent = Number.isFinite(xphr) && xphr > 0
      ? abbreviateValue(Math.floor(xphr))
      : 'NaN';
  }

  // Time to Level (from per-skill xphr)
  if (ttNode) {
    if (isMaxed || !Number.isFinite(xphr) || xphr <= 0) {
      ttNode.textContent = 'NaN';
    } else {
      const toNext = Math.max(0, orb.toNext ?? 0);
      const seconds = toNext === 0 ? 0 : (toNext * 3600) / xphr;
      ttNode.textContent = this.formatHMS(seconds);
    }
  }
}

  // ===== XP/hr window =====
  private gcSamples(orb: OrbState, now: number) {
    const cutoff = now - 5 * 60_000; // 5 minutes
    while (orb.samples.length > 0 && orb.samples[0].t < cutoff) orb.samples.shift();
  }

  private getXpPerHour(orb: OrbState, now: number): number {
    this.gcSamples(orb, now);
    if (orb.samples.length < 2) return 0;
    const first = orb.samples[0], last = orb.samples[orb.samples.length - 1];
    if (last.t <= first.t) return 0;
    return ((last.xp - first.xp) / (last.t - first.t)) * 3_600_000;
  }

  private statsTimer?: number;

private startStatsLoop(): void {
  if (this.statsTimer) return;
  this.statsTimer = window.setInterval(() => {
    const now = Date.now();
    this.orbs.forEach(orb => this.updateOrbEmaFromEvent(orb, now));
    // also refresh numbers so tooltips stay current even without new gains
    this.orbs.forEach(orb => this.renderOrbStatsFor(orb));
  }, 1000);
}

private stopStatsLoop(): void {
  if (!this.statsTimer) return;
  clearInterval(this.statsTimer);
  this.statsTimer = undefined;
}

  // ===== Fade lifecycle =====
  private resetFade(orb: OrbState, now: number) {
  const seconds = this.getFadeSeconds();
  orb.lastActivityMs = now;
  // cancel any pending fade/remove and resurface the orb
  if (orb.fadeHandle) { clearTimeout(orb.fadeHandle); orb.fadeHandle = undefined; }
  if (orb.removeHandle) { clearTimeout(orb.removeHandle); orb.removeHandle = undefined; }
  if (orb.isFading) {
    orb.root.classList.remove('is-fading'); // bring back from opacity:0
    orb.isFading = false;
  }
  // schedule a new fade start
  orb.fadeHandle = window.setTimeout(() => this.beginFade(orb), seconds * 1000);
}

  private pauseFade(orb: OrbState) {
  if (orb.fadeHandle) { clearTimeout(orb.fadeHandle); orb.fadeHandle = undefined; }
  if (orb.removeHandle) { clearTimeout(orb.removeHandle); orb.removeHandle = undefined; }
  if (orb.isFading) {
    orb.root.classList.remove('is-fading');
    orb.isFading = false;
  }
}

  private beginFade(orb: OrbState) {
  // start CSS fade
  orb.isFading = true;
  orb.root.classList.add('is-fading');

  // HARD removal fallback in case transitionend isn’t fired (or is skipped)
  // Keep this short (matches your CSS 220ms transition)
  orb.removeHandle = window.setTimeout(() => {
    // If still fading, remove from DOM + map
    if (orb.isFading) {
      if (orb.root.parentElement) orb.root.parentElement.removeChild(orb.root);
      this.orbs.forEach((v, k) => { if (v === orb) this.orbs.delete(k); });
      orb.isFading = false;
    }
  }, 260);
}

  private resetAllFadeTimers(): void {
    const now = Date.now();
    this.orbs.forEach(o => this.resetFade(o, now));
  }

  private hideAllOrbs(): void {
    this.orbs.forEach(o => o.root.classList.add('is-fading'));
  }

  // ===== Settings-driven style updates =====
private isSettingOn(key: keyof typeof this.settings): boolean {
  const s = this.settings[key as string];
  return !!(s && typeof s.value !== 'undefined' && s.value);
}

// Applies visibility for ONE orb (used on creation and during updates)
private applyTooltipVisibility(orb: OrbState): void {
  if (!orb || !orb.tooltip) return;

  const isMaxed = (orb.currentLevel ?? 0) >= 100;

  const curRow = orb.tooltip.querySelector('[data-row="cur"]')  as HTMLElement | null;
  const toRow  = orb.tooltip.querySelector('[data-row="to"]')   as HTMLElement | null;
  const ttlRow = orb.tooltip.querySelector('[data-row="ttl"]')  as HTMLElement | null;
  const hrRow  = orb.tooltip.querySelector('[data-row="xphr"]') as HTMLElement | null;

  // Current XP
  if (curRow) curRow.classList.toggle('is-hidden', !this.isSettingOn('showCurrentXp'));

  // XP to Level — force hidden if maxed
  const showTo = this.isSettingOn('showXpToLevel') && !isMaxed;
  if (toRow) toRow.classList.toggle('is-hidden', !showTo);

  // Time to Level — also hidden when maxed (spec), regardless of NaN vs value
  const showTTL = this.isSettingOn('showTimeToLevel') && !isMaxed;
  if (ttlRow) ttlRow.classList.toggle('is-hidden', !showTTL);

  // XP/hr — independent of maxed, allowed to show NaN
  if (hrRow) hrRow.classList.toggle('is-hidden', !this.isSettingOn('showXpHr'));
}

// Applies visibility to ALL existing orbs (called by settings callbacks)
private updateTooltipVisibility(): void {
  this.orbs.forEach((orb) => this.applyTooltipVisibility(orb));
}

/*  private updateRingThickness(t: unknown): void {
  const thick = typeof t === 'number' ? t : this.getRingThickness();
  this.orbs.forEach(orb => orb.root.style.setProperty('--thickness', String(thick)));
} */
private updateIconSizes(): void {
  const innerPx = Math.floor(this.getOrbSize() * this.getInnerCoreScale()); // fixed 0.70
  const iconPx  = Math.floor(innerPx * 0.62);
  this.orbs.forEach(o => { o.icon.style.fontSize = iconPx + 'px'; });
}

private updateOrbSizes(n: unknown): void {
  const size = typeof n === 'number' ? n : this.getOrbSize();
  this.orbs.forEach(o => o.root.style.setProperty('--size', size + 'px'));
  this.updateIconSizes();
}

/* private updateInnerCoreScale(v: unknown): void {
  const core = typeof v === 'number' ? v : this.getInnerCoreScale();
  this.orbs.forEach(o => o.root.style.setProperty('--innerScale', String(core))); // 👈 use --innerScale
  this.updateIconSizes();
} */





  // ===== CSS injection =====
  private injectCssOnce() {
    if (this.cssInjected) return;
    this.cssInjected = true;

    const css = `
    /* =========================
   Highlite XP Orbs — Core Styles
   Variables set per-orb from TS:
     --size: px (e.g. "56px")
     --innerScale: 0..1   (e.g. 0.82)
     --thickness:  0..1   (e.g. 0.10 of radius)
     --ringPct:    0..1   (progress toward next level)
     --ringColor:  any CSS color (we compute from ringPct)
   ========================= */

/* group container: centered as a group, click-through */
.hl-xp-orbs{
  pointer-events:none;
  position:absolute;
  left:50%;
  transform:translateX(-50%);
  display:inline-flex;
  width:max-content;
  white-space:nowrap;
  gap:8px;
}

/* one orb */
.hl-xp-orb{
  position:relative;
  pointer-events:auto;
  width:var(--size);
  height:var(--size);
  transition:opacity 220ms ease, transform 220ms ease;

  /* derived (used everywhere) */
  --outerR: calc(var(--size) / 2);
  --innerDpx: calc(var(--size) * var(--innerScale));
  --innerRpx: calc(var(--innerDpx) / 2);
}
.hl-xp-orb.is-fading{ opacity:0; transform:translateY(-4px); }

/* progress ring: */
.hl-xp-orb__ring{
  position:absolute; inset:0; border-radius:50%;
  /* conic progress with a neutral remainder */
  background: conic-gradient(
    var(--ringColor, hsl(0,60%,45%)) calc(var(--ringPct,0)*100%),
    rgba(0,0,0,0.20) 0
  );
  /* cut the inner hole via padding; thickness = --size * --thickness */
  box-sizing: border-box;
  padding: calc(var(--size) * var(--thickness));
  /* keep it a circle and clip hard edge (no inward gradient) */
  clip-path: circle(50% at 50% 50%);
  box-shadow: 0 1px 4px rgba(0,0,0,.25);
}

/* core: solid dark disc (no inward gradient) */
.hl-xp-orb__core{
  position:absolute; inset:0; border-radius:50%;
  background:#1b1b1b;
  -webkit-clip-path:circle(var(--innerRpx) at 50% 50%);
          clip-path:circle(var(--innerRpx) at 50% 50%);
}

/* hover mask: darken core; stays below level text */
.hl-xp-orb__mask{
  position:absolute; inset:0; border-radius:50%;
  background:rgba(0,0,0,.70);
  -webkit-clip-path:circle(var(--innerRpx) at 50% 50%);
          clip-path:circle(var(--innerRpx) at 50% 50%);
  opacity:0; transition:opacity .12s ease; pointer-events:none; z-index:1;
}
.hl-xp-orb.is-hover .hl-xp-orb__mask{ opacity:1; }

/* icon wrap: exact inner circle; hard clip */
.hl-xp-orb__iconwrap{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:var(--innerDpx);
  height:var(--innerDpx);
  border-radius:50%;
  overflow:hidden; overflow:clip;
  -webkit-clip-path:circle(50% at 50% 50%);
          clip-path:circle(50% at 50% 50%);
  display:flex; align-items:center; justify-content:center;
  contain:paint;
}

/* icon glyph (emoji/SVG); font-size set from TS in px */
.hl-xp-orb__icon{
  display:block;
  max-width:100%; max-height:100%;
  line-height:1;
  filter:drop-shadow(0 1px 1px rgba(0,0,0,.4));
  pointer-events:none;
  transition:opacity .12s ease;
}
.hl-xp-orb.is-hover .hl-xp-orb__icon{ opacity:.25; }

/* level badge sits above mask */
.hl-xp-orb__level{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  font-weight:800; font-size:calc(var(--size) * 0.38);
  color:#ffd21e; text-shadow:0 1px 2px rgba(0,0,0,.6);
  pointer-events:none; opacity:0; z-index:2;
}
.hl-xp-orb.is-hover .hl-xp-orb__level{ opacity:1; }

/* tooltip below with aligned columns */
.hl-xp-orb__tip{
  position:absolute; left:50%; top:calc(100% + 8px);
  transform:translateX(-50%) translateY(-2px);
  min-width:200px; padding:8px 10px; border-radius:10px;
  background:rgba(0,0,0,.85); color:#fff; font-size:12px; line-height:1.35;
  box-shadow:0 4px 12px rgba(0,0,0,.35);
  opacity:0; pointer-events:none; transition:opacity .12s ease, transform .12s ease;
}
.hl-xp-orb.is-hover .hl-xp-orb__tip{ opacity:1; transform:translateX(-50%) translateY(0); }

.hl-xp-orb__tip-header{ display:flex; justify-content:space-between; gap:12px; margin-bottom:6px; font-weight:700; }
.hl-xp-orb__tip-row{ display:flex; justify-content:space-between; gap:24px; }
.hl-xp-orb__tip-row span:first-child{ text-align:left; }
.hl-xp-orb__tip-row span:last-child{ text-align:right; min-width:96px; }

.hl-xp-orb__tip::after{
  content:""; position:absolute; left:50%; bottom:100%; transform:translateX(-50%);
  border:6px solid transparent; border-bottom-color:rgba(0,0,0,.85);
}


.hl-xp-orb__tip-row.is-hidden { display: none !important; }
`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ===== Settings helpers =====

    private toNum(v: unknown, fallback: number): number {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }

    private formatHMS(totalSeconds: number): string {
            if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 'NaN';
            const s = Math.floor(totalSeconds % 60);
            const m = Math.floor((totalSeconds / 60) % 60);
            const h = Math.floor(totalSeconds / 3600);
            const mm = m.toString().padStart(2, '0');
            const ss = s.toString().padStart(2, '0');
            return `${h}:${mm}:${ss}`; // 1 or 2 or 3+ digits for hours automatically
        }

    private getInnerCoreScale(): number { return this.INNER_CORE_SCALE_INT / 100; } // 0.70
    private getRingThickness(): number  { return this.RING_THICKNESS_INT   / 100; } // 0.04

    private getOrbSize(): number        { return this.toNum(this.settings.orbSize.value, 56); }
    private getOrbSizeCss(): string     { return this.getOrbSize() + 'px'; }

    private getFadeSeconds(): number      { return this.toNum(this.settings.fadeSeconds.value, 5); }

    private resetSettingsToDefaults(): void {
        const d = this.getDefaultSettings();
        // copy values back into the existing settings object so the UI sees updates
        for (const k in d) {
            if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
            if (!this.settings[k]) this.settings[k] = d[k];
            else this.settings[k].value = d[k].value;
        }
        // apply visuals without recreating orbs
        this.refreshLayoutFromSettings();
    }

  private titleCase(s: string): string {
    return s.replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  private updateOrbEmaFromEvent(orb: OrbState, nowMs: number): void {
  if (orb._lastSampleTs == null || orb._lastSampleXp == null) {
    orb._lastSampleTs = nowMs;
    orb._lastSampleXp = orb.totalXp ?? 0;
    return;
  }
  const dtMs = nowMs - orb._lastSampleTs;
  if (dtMs < 250) return; // avoid noisy tiny intervals

  const dxp   = (orb.totalXp ?? 0) - orb._lastSampleXp;
  const hours = dtMs / 3_600_000;
  const inst  = hours > 0 ? (dxp / hours) : NaN;

  const TAU_SECONDS = 30; // smoothing constant (lower = snappier)
  const alpha = Math.max(0, Math.min(1, dtMs / (TAU_SECONDS * 1000)));

  if (Number.isFinite(inst)) {
    orb.emaXpPerHour = (orb.emaXpPerHour == null)
      ? inst
      : (alpha * inst + (1 - alpha) * orb.emaXpPerHour);
  }

  orb._lastSampleTs = nowMs;
  orb._lastSampleXp = orb.totalXp ?? 0;
}

// Prefer EMA; fallback to average since first gain for THIS skill
private getSkillXpPerHour(orb: OrbState, nowMs: number): number {
  if (Number.isFinite(orb.emaXpPerHour as number) && (orb.emaXpPerHour as number) > 0) {
    return orb.emaXpPerHour as number;
  }
  if (orb.startTs == null || orb.startXp == null) return NaN;
  const dtHours = (nowMs - orb.startTs) / 3_600_000;
  if (dtHours <= 0) return NaN;
  const gained = (orb.totalXp ?? 0) - orb.startXp;
  if (gained <= 0) return NaN;
  return gained / dtHours;
}

}
