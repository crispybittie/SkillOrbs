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
    enable:        { type: SettingsTypes.checkbox, text: 'Enable XP Orbs', value: true,
      callback: (v: boolean) => { if (!v) this.hideAllOrbs(); else this.refreshLayoutFromSettings(); } },

    showCurrentXp: { type: SettingsTypes.checkbox, text: 'Show Current XP',  value: true,
      callback: () => this.updateTooltipVisibility() },

    showXpToLevel: { type: SettingsTypes.checkbox, text: 'Show XP to Level', value: true,
      callback: () => this.updateTooltipVisibility() },

    showXpHr:      { type: SettingsTypes.checkbox, text: 'Show XP/hr',       value: true,
      callback: () => this.updateTooltipVisibility() },

    fadeSeconds:   { type: SettingsTypes.range,    text: 'Fade After (seconds)', value: 5, min: 1,  max: 20,
      callback: () => this.resetAllFadeTimers() },

    ringThickness: {
  type: SettingsTypes.range,
  text: 'Outer Ring Thickness',
  value: 10,   // percent-of-radius; 10 -> 0.10
  min: 4,      // 4% .. 18%
  max: 18,
  callback: (v: number) => this.updateRingThickness(this.toNum(v, 10)),
},

innerCoreScale: {
  type: SettingsTypes.range,
  text: 'Inner Core Scale',
  value: 82,   // percent-of-radius; 82 -> 0.82
  min: 70,
  max: 95,
  callback: (v: number) => this.updateInnerCoreScale(this.toNum(v, 82)),
},

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

    this.log('Experience Orbs stopped');
  }

  GameLoop_update(): void {
  if (!this.settings.enable.value) return;

  // hard guards
  if (!this.gameHooks || !this.gameHooks.EntityManager || !this.gameHooks.EntityManager.Instance) return;
  const main = this.gameHooks.EntityManager.Instance.MainPlayer;
  if (!main) return;

  // Normalize both sources; these calls handle: undefined, arrays, object maps, or nested {_skills}
  const resourceSkills: Skill[] = this.normalizeSkillsBag(main.Skills ? main.Skills._skills ?? main.Skills : []);
  const combatSkills:  Skill[] = this.normalizeSkillsBag(main.Combat ? main.Combat._skills ?? main.Combat : []);

  // Merge and bail early if empty
  const allSkills: Skill[] = resourceSkills.concat(combatSkills);
  if (allSkills.length === 0) return;

  const now = Date.now();
    console.debug('[XP Orbs] skills shapes', { resLen: resourceSkills.length, cmbLen: combatSkills.length });
  for (let i = 0; i < allSkills.length; i++) {
    const s = allSkills[i];
    // extra guard in case normalize missed something weird
    if (!this.isValidSkill(s)) continue;

    // Lookup the display name; fall back to the numeric id if lookup table is missing
    const skillNameLookup =
      (this.gameLookups && this.gameLookups['Skills'] && this.gameLookups['Skills'][s._skill]) ||
      String(s._skill);
    const skillKey: string = skillNameLookup;

    // delta detection
    const last = this.prevXp.has(skillKey) ? this.prevXp.get(skillKey)! : s._xp;
    const delta = s._xp - last;
    this.prevXp.set(skillKey, s._xp);
    if (delta <= 0) continue;

    const orb = this.ensureOrb(skillKey);

    // level boundaries with safe fallbacks
    const curFloor = this.levelToXP[s._level] ?? 0;
    const nextFloor = this.levelToXP[s._level + 1] ?? curFloor;
    const span = Math.max(1, nextFloor - curFloor);
    const into = Math.max(0, s._xp - curFloor);

    orb.currentLevel = s._level;
    orb.totalXp = s._xp;
    orb.progress01 = Math.min(1, into / span);
    orb.toNext = Math.max(0, nextFloor - s._xp);

    // XP/hr window
    orb.samples.push({ xp: s._xp, t: now });
    this.gcSamples(orb, now);

    // paint + keep-alive
    this.renderOrb(orb);
    this.resetFade(orb, now);
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
  this.updateRingThickness(this.getRingThickness());
  this.updateInnerCoreScale(this.getInnerCoreScale());
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
    root.style.setProperty('--thickness', String(this.getRingThickness()));          // 0.04..0.18
    root.style.setProperty('--innerScale', String(this.getInnerCoreScale()));        // 0.70..0.95  👈 NEW name

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
    const corePx = Math.floor(this.getOrbSize() * this.getInnerCoreScale()); // = --innerDpx
const fontPx = Math.floor(corePx * 0.74);  // 74% of inner diameter sits comfortably inside the clip
icon.style.fontSize = fontPx + 'px';



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
        <div class="hl-xp-orb__tip-row${this.settings.showCurrentXp.value ? '' : ' is-hidden'}">
            <span>Current XP</span><span data-k="cur">0</span>
        </div>
        <div class="hl-xp-orb__tip-row row-xpToLevel${this.settings.showXpToLevel.value ? '' : ' is-hidden'}">
            <span>XP to Level</span><span data-k="to">0</span>
        </div>
        <div class="hl-xp-orb__tip-row${this.settings.showXpHr.value ? '' : ' is-hidden'}">
            <span>XP/hr</span><span data-k="xphr">0</span>
        </div>
        `;

    root.appendChild(ring);
    root.appendChild(iconWrap);   // NEW wrapper sized to the inner core
    iconWrap.appendChild(icon);   // emoji now lives inside the wrapper
    root.appendChild(hoverMask); // NEW (sits above icon)
    root.appendChild(levelBadge);
    root.appendChild(tip);

    

    if (this.orbsRow) this.orbsRow.appendChild(root);

    const state: OrbState = {
      root, ring, core, icon, levelBadge, tooltip: tip, hoverMask,
      totalXp: 0, currentLevel: 1, toNext: 0, progress01: 0,
      samples: [],
      lastActivityMs: Date.now(),
    };
    this.orbs.set(skillName, state);
    return state;
  }

  private renderOrb(orb: OrbState) {
    // Force 100% fill and "Maxed" semantics at level 100
    const isMaxed = orb.currentLevel >= 100;
    const progress01 = isMaxed ? 1 : orb.progress01;
    const pct = Math.round(progress01 * 100);
    orb.root.style.setProperty('--ring-pct', String(pct));

    // Map 0..1 -> hue 0..120 (muted red to muted green), low saturation for “muted”
    const hue = Math.round(120 * orb.progress01);       // 0 = red, 120 = green
    const sat = 42;                                      // muted
    const light = 46;                                    // mid
    const ringColor = `hsl(${hue} ${sat}% ${light}%)`;
    orb.root.style.setProperty('--ring-color', ringColor);

    orb.levelBadge.textContent = String(orb.currentLevel);

    const curNode = orb.tooltip.querySelector('[data-k="cur"]') as HTMLElement | null;
    const toNode  = orb.tooltip.querySelector('[data-k="to"]')  as HTMLElement | null;
    const hrNode  = orb.tooltip.querySelector('[data-k="xphr"]') as HTMLElement | null;
    const progEl  = orb.tooltip.querySelector('.tip-progress') as HTMLElement | null;
    const toRow   = orb.tooltip.querySelector('.row-xpToLevel') as HTMLElement | null;

    if (curNode) curNode.textContent = abbreviateValue(orb.totalXp);
    if (isMaxed) {
        if (progEl) progEl.textContent = 'Maxed';
            if (toRow)  toRow.classList.add('is-hidden');
        } else {
            const pctToNext = (100 - pct).toFixed(1); // or show remaining percent
            if (progEl) progEl.textContent = `(${pct.toFixed(1)}% to Next)`;
            if (toRow)  toRow.classList.remove('is-hidden');
            if (toNode) toNode.textContent = abbreviateValue(Math.max(0, Math.floor(orb.toNext)));
        }

    const xphr = Math.floor(this.getXpPerHour(orb, Date.now()));
    if (hrNode) hrNode.textContent = abbreviateValue(xphr);
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
  private updateTooltipVisibility(): void {
    const showCur = !!this.settings.showCurrentXp.value;
    const showTo  = !!this.settings.showXpToLevel.value;
    const showHr  = !!this.settings.showXpHr.value;

    this.orbs.forEach(orb => {
      const rows = orb.tooltip.querySelectorAll('.hl-xp-orb__tip-row');
      rows.forEach(row => row.classList.remove('is-hidden'));
      const curRow = orb.tooltip.querySelector('.hl-xp-orb__tip-row:nth-of-type(2)') as HTMLElement | null;
      const toRow  = orb.tooltip.querySelector('.hl-xp-orb__tip-row:nth-of-type(3)') as HTMLElement | null;
      const hrRow  = orb.tooltip.querySelector('.hl-xp-orb__tip-row:nth-of-type(4)') as HTMLElement | null;
      if (curRow && !showCur) curRow.classList.add('is-hidden');
      if (toRow  && !showTo)  toRow.classList.add('is-hidden');
      if (hrRow  && !showHr)  hrRow.classList.add('is-hidden');
    });
  }

  private updateRingThickness(t: unknown): void {
  const thick = typeof t === 'number' ? t : this.getRingThickness();
  this.orbs.forEach(orb => orb.root.style.setProperty('--thickness', String(thick)));
}
private updateIconSizes(): void {
  const corePx = Math.floor(this.getOrbSize() * this.getInnerCoreScale());
  const fontPx = Math.floor(corePx * 0.74);
  this.orbs.forEach(o => { o.icon.style.fontSize = fontPx + 'px'; });
}

private updateOrbSizes(n: unknown): void {
  const size = typeof n === 'number' ? n : this.getOrbSize();
  this.orbs.forEach(o => o.root.style.setProperty('--size', size + 'px'));
  this.updateIconSizes();
}

private updateInnerCoreScale(v: unknown): void {
  const core = typeof v === 'number' ? v : this.getInnerCoreScale();
  this.orbs.forEach(o => o.root.style.setProperty('--innerScale', String(core))); // 👈 use --innerScale
  this.updateIconSizes();
}





  // ===== CSS injection =====
  private injectCssOnce() {
    if (this.cssInjected) return;
    this.cssInjected = true;

    const css = `/* =========================
   XP Orbs — container + orb
   Inputs from TS per-orb:
     --size: px (e.g. "56px")
     --thickness: fraction of radius (0.04..0.18)
     --innerScale: fraction of radius (0.70..0.95)
   ========================= */

/* Group container: click-through, shrink-wraps to contents, centered as a group.
   (JS sets top/left; we keep the centering defaults here too.) */
.hl-xp-orbs {
  pointer-events: none;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  width: max-content;
  white-space: nowrap;
  gap: 8px;
}

/* Single orb root — defines derived vars used by all children */
.hl-xp-orb {
  pointer-events: auto;
  position: relative;
  width: var(--size);
  height: var(--size);
  transition: opacity 220ms ease, transform 220ms ease;
  /* Derived (keep in sync everywhere) */
  --innerR:   calc(var(--innerScale, 0.82) * 50%);                    /* inner radius, % of box */
  --innerDpx: calc(var(--size, 56px) * var(--innerScale, 0.82));      /* inner diameter, px */
}
.hl-xp-orb.is-fading { opacity: 0; transform: translateY(-4px); }

/* ----- RING (progress) ----- */
/* Conic fill clipped at the same inner radius the core uses */
.hl-xp-orb__ring {
  position: absolute; inset: 0; border-radius: 50%;
  --t: var(--thickness, 0.10);
  --ringInner: max(var(--innerR), calc((1 - var(--t)) * 50%));
  background: conic-gradient(var(--ring-color, #7aa96b) calc(var(--ring-pct, 0) * 1%),
                             rgba(0,0,0,0.18) 0);
  /* precise radial mask (±0.5px overlap avoids AA gaps) */
  -webkit-mask: radial-gradient(circle,
                    transparent calc(var(--ringInner) - 0.5px),
                    #000        calc(var(--ringInner) + 0.5px));
          mask: radial-gradient(circle,
                    transparent calc(var(--ringInner) - 0.5px),
                    #000        calc(var(--ringInner) + 0.5px));
  box-shadow: 0 1px 4px rgba(0,0,0,0.25);
}

/* ----- CORE (solid interior) ----- */
.hl-xp-orb__core {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(closest-side, #1b1b1b 0 var(--innerR), transparent 0);
}

/* ----- HOVER MASK (darkens core; sits below level text) ----- */
.hl-xp-orb__mask {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(0,0,0,0.70) 0 var(--innerR), transparent 0);
  opacity: 0; transition: opacity 120ms ease; pointer-events: none; z-index: 1;
}
.hl-xp-orb.is-hover .hl-xp-orb__mask { opacity: 1; }

/* ----- ICON WRAP (exact inner circle; hard clip) ----- */
.hl-xp-orb__iconwrap {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width:  var(--innerDpx);
  height: var(--innerDpx);
  border-radius: 50%;
  overflow: hidden; overflow: clip;
  -webkit-clip-path: circle(calc(50% - 1px) at 50% 50%);
          clip-path: circle(calc(50% - 1px) at 50% 50%);
  pointer-events: none;
  display: flex; align-items: center; justify-content: center;
  contain: paint;
}

/* Actual emoji/icon glyph — font-size is set from TS in px */
.hl-xp-orb__icon {
  display: block;
  max-width: 100%; max-height: 100%;
  line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4));
  pointer-events: none;
  transition: opacity 120ms ease;
}

/* ----- LEVEL BADGE (on hover) ----- */
.hl-xp-orb__level {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  font-weight: 800; font-size: calc(var(--size) * 0.38);
  color: #ffd21e; text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  pointer-events: none; opacity: 0; z-index: 2;
}
.hl-xp-orb.is-hover .hl-xp-orb__level { opacity: 1; }
.hl-xp-orb.is-hover .hl-xp-orb__icon  { opacity: 0.25; }

/* ----- TOOLTIP (below the orb) ----- */
.hl-xp-orb__tip {
  position: absolute; left: 50%; top: calc(100% + 8px);
  transform: translateX(-50%) translateY(-2px);
  min-width: 200px; padding: 8px 10px; border-radius: 10px;
  background: rgba(0,0,0,0.85); color: white; font-size: 12px; line-height: 1.35;
  box-shadow: 0 4px 12px rgba(0,0,0,0.35);
  opacity: 0; pointer-events: none; transition: opacity 120ms ease, transform 120ms ease;
}
.hl-xp-orb.is-hover .hl-xp-orb__tip { opacity: 1; transform: translateX(-50%) translateY(0); }

.hl-xp-orb__tip-header { display:flex; justify-content:space-between; gap:12px; margin-bottom:6px; font-weight:700; }
.hl-xp-orb__tip-row    { display:flex; justify-content:space-between; gap:24px; }
.hl-xp-orb__tip-row span:first-child { text-align:left; }
.hl-xp-orb__tip-row span:last-child  { text-align:right; min-width: 96px; }
.hl-xp-orb__tip-row.is-hidden { display:none; }

.hl-xp-orb__tip::after {
  content:""; position:absolute; left:50%; bottom:100%; transform:translateX(-50%);
  border:6px solid transparent; border-bottom-color: rgba(0,0,0,0.85);
}
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

    private getRingThickness(): number  { return this.toNum(this.settings.ringThickness.value, 10) / 100; }
    private getInnerCoreScale(): number { return this.toNum(this.settings.innerCoreScale.value, 82) / 100; }
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
}
