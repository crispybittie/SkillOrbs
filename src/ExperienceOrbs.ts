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
  icon: HTMLDivElement;
  levelBadge: HTMLDivElement;
  tooltip: HTMLDivElement;

  totalXp: number;
  currentLevel: number;
  toNext: number;
  progress01: number;

  samples: Array<{ xp: number; t: number }>;
  fadeHandle?: number;
  lastActivityMs: number;
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
    enable: {
      type: SettingsTypes.checkbox,
      text: 'Enable XP Orbs',
      value: true,
      callback: (v: boolean) => {
        if (!v) this.hideAllOrbs();
        else this.refreshLayoutFromSettings();
      },
    },
    showCurrentXp: {
      type: SettingsTypes.checkbox,
      text: 'Show Current XP',
      value: true,
      callback: (_v: boolean) => this.updateTooltipVisibility(),
    },
    showXpToLevel: {
      type: SettingsTypes.checkbox,
      text: 'Show XP to Level',
      value: true,
      callback: (_v: boolean) => this.updateTooltipVisibility(),
    },
    showXpHr: {
      type: SettingsTypes.checkbox,
      text: 'Show XP/hr',
      value: true,
      callback: (_v: boolean) => this.updateTooltipVisibility(),
    },
    fadeSeconds: {
      type: SettingsTypes.range,
      text: 'Fade After (seconds)',
      value: 5,
      min: 1,
      max: 20,
      callback: (_v: number) => this.resetAllFadeTimers(),
    },
    ringThickness: {
      type: SettingsTypes.range,
      text: 'Ring Thickness',
      value: 0.26,     // fraction of radius; UI will handle precision
      min: 0.12,
      max: 0.40,
      callback: (v: number) => this.updateRingThickness(v),
    },
    offsetY: {
      type: SettingsTypes.range,
      text: 'Vertical Offset (px)',
      value: 6,
      min: -40,
      max: 80,
      callback: (v: number) => { if (this.orbsRow) this.orbsRow.style.top = String(v) + 'px'; },
    },
    orbSize: {
      type: SettingsTypes.range,
      text: 'Orb Size (px)',
      value: 56,
      min: 36,
      max: 96,
      callback: (v: number) => this.updateOrbSizes(v),
    },
  };
}


  // ===== Lifecycle =====
  init(): void {
    this.uiManager = (this as unknown as { uiManager: UIManager }).uiManager;
    this.settings = this.getDefaultSettings();
}

  start(): void {
    this.injectCssOnce();
    this.setupRoot();
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    if (this.domRoot && this.onMouseMoveBound) {
      this.domRoot.addEventListener('mousemove', this.onMouseMoveBound);
    }
    this.refreshLayoutFromSettings();
    this.log('Experience Orbs started');
  }

  stop(): void {
    this.orbs.forEach(o => o.root.remove());
    this.orbs.clear();
    this.prevXp.clear();
    this.cleanupRoot();
    if (this.domRoot && this.onMouseMoveBound) {
        this.domRoot.removeEventListener('mousemove', this.onMouseMoveBound);
    }
    this.onMouseMoveBound = null;

    this.log('Experience Orbs stopped');
  }

  GameLoop_update(): void {
    if (!this.settings.enable.value) return;

    // strict guards
    if (!this.gameHooks) return;
    if (!this.gameHooks.EntityManager) return;
    if (!this.gameHooks.EntityManager.Instance) return;
    if (!this.gameHooks.EntityManager.Instance.MainPlayer) return;

    const main = this.gameHooks.EntityManager.Instance.MainPlayer;

    let resourceSkills: Skill[] = [];
    if (main.Skills && Array.isArray(main.Skills._skills)) resourceSkills = main.Skills._skills as Skill[];

    let combatSkills: Skill[] = [];
    if (main.Combat && Array.isArray(main.Combat._skills)) combatSkills = main.Combat._skills as Skill[];

    const allSkills = resourceSkills.concat(combatSkills);
    if (allSkills.length === 0) return;

    const now = Date.now();

    for (let i = 0; i < allSkills.length; i++) {
      const s = allSkills[i];
      const skillNameLookup = this.gameLookups && this.gameLookups['Skills'] ? this.gameLookups['Skills'][s._skill] : undefined;
      if (!skillNameLookup) continue;

      const last = this.prevXp.has(skillNameLookup) ? this.prevXp.get(skillNameLookup)! : s._xp;
      const delta = s._xp - last;
      this.prevXp.set(skillNameLookup, s._xp);
      if (delta <= 0) continue; // only react to XP increases

      const orb = this.ensureOrb(skillNameLookup);

      const curFloor = this.levelToXP[s._level] ? this.levelToXP[s._level] : 0;
      const nextFloor = this.levelToXP[s._level + 1] ? this.levelToXP[s._level + 1] : curFloor;
      const span = nextFloor - curFloor > 0 ? nextFloor - curFloor : 1;
      const into = s._xp - curFloor > 0 ? s._xp - curFloor : 0;

      orb.currentLevel = s._level;
      orb.totalXp = s._xp;
      orb.progress01 = into / span > 1 ? 1 : into / span;
      orb.toNext = nextFloor - s._xp > 0 ? nextFloor - s._xp : 0;

      // XP/hr samples
      orb.samples.push({ xp: s._xp, t: now });
      this.gcSamples(orb, now);

      // Paint
      this.renderOrb(orb);

      // Keep alive (resets per‑skill fade timer)
      this.resetFade(orb, now);
    }
  }

  // ===== Root mounting (Nameplates pattern) =====
  private setupRoot(): void {
    this.cleanupRoot();

    const root = this.uiManager.createElement(UIManagerScope.ClientRelative) as HTMLDivElement;
    this.domRoot = root;
    root.id = 'highlite-xp-orbs-root';
    root.style.position = 'absolute';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '1';
    root.style.overflow = 'hidden';
    root.style.width = '100%';
    root.style.height = 'calc(100% - var(--titlebar-height))';
    root.style.top = 'var(--titlebar-height)';
    root.style.fontFamily = 'Inter';
    root.style.fontSize = '12px';
    root.style.fontWeight = 'bold';

    const row = document.createElement('div');
    this.orbsRow = row;
    row.className = 'hl-xp-orbs';
    row.style.position = 'absolute';
    row.style.left = '50%';
    row.style.transform = 'translateX(-50%)';
    row.style.top = this.getOffsetYCss();
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.pointerEvents = 'none';

    root.appendChild(row);
  }

  private cleanupRoot(): void {
    if (this.orbsRow && this.orbsRow.parentElement) this.orbsRow.parentElement.removeChild(this.orbsRow);
    if (this.domRoot && this.domRoot.parentElement) this.domRoot.parentElement.removeChild(this.domRoot);
    this.orbsRow = null;
    this.domRoot = null;
  }

  private onMouseMove(e: MouseEvent): void {
  // mouse coords relative to viewport
    const mx = e.clientX;
    const my = e.clientY;

    let hoveredKey: string | null = null;

    // Find which orb (if any) is under the cursor by bounding box check
    this.orbs.forEach((orb, key) => {
        const rect = orb.root.getBoundingClientRect();
        if (mx >= rect.left && mx <= rect.right && my >= rect.top && my <= rect.bottom) {
        hoveredKey = key;
        }
    });

    if (hoveredKey !== this.lastHoverKey) {
        // Hover changed → clear previous hover state
        if (this.lastHoverKey && this.orbs.has(this.lastHoverKey)) {
        const prev = this.orbs.get(this.lastHoverKey)!;
        prev.root.classList.remove('is-hover');
        // Per spec, reset timer when hover ENDS
        this.resetFade(prev, Date.now());
        }
        // Apply new hover
        if (hoveredKey && this.orbs.has(hoveredKey)) {
        const cur = this.orbs.get(hoveredKey)!;
        cur.root.classList.add('is-hover');
        // Pause fade while hovering
        this.pauseFade(cur);
        }
        this.lastHoverKey = hoveredKey;
    }
}

  private refreshLayoutFromSettings(): void {
    if (this.orbsRow) {
      this.orbsRow.style.top = this.getOffsetYCss();
    }
    this.updateOrbSizes(this.settings.orbSize.value);
    this.updateRingThickness(this.settings.ringThickness.value);
    this.updateTooltipVisibility();
    this.resetAllFadeTimers();
  }

  // ===== Orbs =====
  private ensureOrb(skillName: string): OrbState {
    if (this.orbs.has(skillName)) return this.orbs.get(skillName)!;

    const root = document.createElement('div');
    root.className = 'hl-xp-orb';
    root.style.setProperty('--size', this.getOrbSizeCss());

    const ring = document.createElement('div');
    ring.className = 'hl-xp-orb__ring';
    ring.style.setProperty('--thickness', String(this.getRingThickness()));

    const icon = document.createElement('div');
    icon.className = 'hl-xp-orb__icon';
    icon.textContent = this.skillToIcon[skillName] ? this.skillToIcon[skillName] : '✨';

    const levelBadge = document.createElement('div');
    levelBadge.className = 'hl-xp-orb__level';
    levelBadge.textContent = '1';

    const tip = document.createElement('div');
    tip.className = 'hl-xp-orb__tip';
    tip.innerHTML = `
      <div class="hl-xp-orb__tip-title">${this.titleCase(skillName)}</div>
      <div class="hl-xp-orb__tip-row${this.settings.showCurrentXp.value ? '' : ' is-hidden'}">
        <span>Current XP</span><span data-k="cur">0</span>
      </div>
      <div class="hl-xp-orb__tip-row${this.settings.showXpToLevel.value ? '' : ' is-hidden'}">
        <span>XP to Level</span><span data-k="to">0</span>
      </div>
      <div class="hl-xp-orb__tip-row${this.settings.showXpHr.value ? '' : ' is-hidden'}">
        <span>XP/hr</span><span data-k="xphr">0</span>
      </div>
    `;

    root.appendChild(ring);
    root.appendChild(icon);
    root.appendChild(levelBadge);
    root.appendChild(tip);

    // Hover behaviour

    

    if (this.orbsRow) this.orbsRow.appendChild(root);

    const state: OrbState = {
      root, ring, icon, levelBadge, tooltip: tip,
      totalXp: 0, currentLevel: 1, toNext: 0, progress01: 0,
      samples: [],
      lastActivityMs: Date.now(),
    };
    this.orbs.set(skillName, state);
    return state;
  }

  private renderOrb(orb: OrbState) {
    const pct = Math.round(orb.progress01 * 100);
    orb.root.style.setProperty('--ring-pct', String(pct));

    orb.levelBadge.textContent = String(orb.currentLevel);

    const curNode = orb.tooltip.querySelector('[data-k="cur"]') as HTMLElement | null;
    const toNode  = orb.tooltip.querySelector('[data-k="to"]')  as HTMLElement | null;
    const hrNode  = orb.tooltip.querySelector('[data-k="xphr"]') as HTMLElement | null;

    if (curNode) curNode.textContent = abbreviateValue(orb.totalXp);
    if (toNode)  toNode.textContent  = abbreviateValue(orb.toNext > 0 ? Math.floor(orb.toNext) : 0);

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
    if (orb.fadeHandle) {
      clearTimeout(orb.fadeHandle);
      orb.fadeHandle = undefined;
    }
    orb.root.classList.remove('is-fading');
    orb.fadeHandle = window.setTimeout(() => this.beginFade(orb), seconds * 1000);
  }

  private pauseFade(orb: OrbState) {
    if (orb.fadeHandle) {
      clearTimeout(orb.fadeHandle);
      orb.fadeHandle = undefined;
    }
    orb.root.classList.remove('is-fading');
  }

  private beginFade(orb: OrbState) {
    const self = this;
    orb.root.classList.add('is-fading');
    const end = function () {
      orb.root.removeEventListener('transitionend', end);
      if (orb.root.classList.contains('is-fading')) {
        if (orb.root.parentElement) orb.root.parentElement.removeChild(orb.root);
        self.orbs.forEach(function (v, k) {
          if (v === orb) self.orbs.delete(k);
        });
      }
    };
    orb.root.addEventListener('transitionend', end);
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

  private updateOrbSizes(px: number): void {
    const val = String(px) + 'px';
    this.orbs.forEach(orb => {
      orb.root.style.setProperty('--size', val);
      // icon/level scale from CSS using --size, so no extra work
    });
  }

  private updateRingThickness(t: number): void {
    this.orbs.forEach(orb => {
      orb.ring.style.setProperty('--thickness', String(t));
    });
  }

  // ===== CSS injection =====
  private injectCssOnce() {
    if (this.cssInjected) return;
    this.cssInjected = true;

    const css = `
.hl-xp-orbs {
  pointer-events: none;
  display: flex;
  gap: 8px;
}

/* each orb */
.hl-xp-orb {
  --size: 56px;
  position: relative;
  width: var(--size);
  height: var(--size);
  pointer-events: none;
  transition: opacity 220ms ease, transform 220ms ease;
  color: white;
}
.hl-xp-orb.is-fading { opacity: 0; transform: translateY(-4px); }

/* ring: track + conic progress; thickness via --thickness (0..1 of radius) */
.hl-xp-orb__ring {
  position: absolute; inset: 0; border-radius: 50%;
  --t: var(--thickness, 0.26);
  --innerStop: calc((1 - var(--t)) * 50%);
  background:
    radial-gradient(closest-side, rgba(0,0,0,0) var(--innerStop), rgba(0,0,0,0.18) calc(var(--innerStop) + 2%), rgba(0,0,0,0) calc(var(--innerStop) + 2%)),
    conic-gradient(currentColor calc(var(--ring-pct, 0) * 1%), rgba(0,0,0,0.18) 0);
  box-shadow: 0 1px 4px rgba(0,0,0,0.25);
  pointer-events: none;
}

.hl-xp-orb__icon {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  font-size: calc(var(--size) * 0.54);
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.4));
  pointer-events: none;
  transition: opacity 120ms ease;
}

.hl-xp-orb__level {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  font-weight: 800;
  font-size: calc(var(--size) * 0.38);
  line-height: 1;
  letter-spacing: 0.02em;
  opacity: 0; pointer-events: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}

.hl-xp-orb.is-hover .hl-xp-orb__icon { opacity: 0.25; }
.hl-xp-orb.is-hover .hl-xp-orb__level { opacity: 1; }

/* tooltip */
.hl-xp-orb__tip {
  position: absolute; left: 50%; bottom: calc(100% + 8px);
  transform: translateX(-50%) translateY(2px);
  min-width: 180px; padding: 8px 10px; border-radius: 10px;
  background: rgba(0,0,0,0.85); color: white;
  font-size: 12px; line-height: 1.35;
  opacity: 0; pointer-events: none;
  transition: opacity 120ms ease, transform 120ms ease;
  box-shadow: 0 4px 12px rgba(0,0,0,0.35);
}
.hl-xp-orb.is-hover .hl-xp-orb__tip { opacity: 1; transform: translateX(-50%) translateY(0); }

.hl-xp-orb__tip-title { font-weight: 700; margin-bottom: 6px; opacity: 0.95; }
.hl-xp-orb__tip-row  { display: flex; justify-content: space-between; gap: 12px; opacity: 0.95; }
.hl-xp-orb__tip-row.is-hidden { display: none; }
.hl-xp-orb__tip::after {
  content: ""; position: absolute; left: 50%; top: 100%;
  transform: translateX(-50%); border: 6px solid transparent; border-top-color: rgba(0,0,0,0.85);
}
`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ===== Settings helpers =====
    private getFadeSeconds(): number { return Number(this.settings.fadeSeconds.value); }
    private getOffsetYCss(): string   { return String(this.settings.offsetY.value) + 'px'; }
    private getOrbSizeCss(): string   { return String(this.settings.orbSize.value) + 'px'; }
    private getRingThickness(): number{ return Number(this.settings.ringThickness.value); }


  private titleCase(s: string): string {
    return s.replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
}
