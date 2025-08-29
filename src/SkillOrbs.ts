import { Plugin, UIManager, UIManagerScope, abbreviateValue } from '@highlite/core';
import { SettingsTypes, PluginSettings } from '@highlite/core';
import styles from "../resources/css/skill-orbs.css";

  // ===== INTERFACES AND TYPE DECLARATION =====

interface Skill {
    _skill: number;
    _level: number;
    _xp: number;
}

interface OrbState {
    root: HTMLDivElement;
    ring: HTMLDivElement;
    core: HTMLDivElement;
    iconWrap: HTMLDivElement;
    iconCenter: HTMLDivElement;
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
    startXp?: number;
    startTs?: number;
    emaXpPerHour?: number;
    _lastSampleXp?: number;
    _lastSampleTs?: number;
}

type SkillName = string;

// ===== CONSTANTS =====
const CONSTANTS = {
  INNER_CORE_SCALE_INT: 70, // %
  INNER_CORE_OPACITY: 1,
  RING_THICKNESS_INT: 4,    // % of radius
  DEFAULT_ORB_SIZE: 56,
  MIN_ORB_SIZE: 36,
  MAX_ORB_SIZE: 96,
  ICON_SCALE_PCT: 80,
  FADE_DURATION_MS: 220,
  EMA_TAU_SECONDS: 30,
  SAMPLE_RETENTION_MS: 5 * 60 * 1000,
  
  LEVEL_TO_XP: {
    1: 0, 2: 99, 3: 210, 4: 333, 5: 470, 6: 622, 7: 791, 8: 978, 9: 1185, 10: 1414,
    11: 1667, 12: 1947, 13: 2256, 14: 2598, 15: 2976, 16: 3393, 17: 3854, 18: 4363, 19: 4925, 20: 5546,
    21: 6232, 22: 6989, 23: 7825, 24: 8749, 25: 9769, 26: 10896, 27: 12141, 28: 13516, 29: 15035, 30: 16713,
    31: 18567, 32: 20616, 33: 22880, 34: 25382, 35: 28147, 36: 31202, 37: 34579, 38: 38311, 39: 42436, 40: 46996,
    41: 52037, 42: 57609, 43: 63769, 44: 70579, 45: 78108, 46: 86433, 47: 95637, 48: 105814, 49: 117067, 50: 129510,
    51: 143269, 52: 158484, 53: 175309, 54: 193915, 55: 214491, 56: 237246, 57: 262410, 58: 290240, 59: 321018, 60: 355057,
    61: 392703, 62: 434338, 63: 480386, 64: 531315, 65: 587643, 66: 649943, 67: 718848, 68: 795059, 69: 879351, 70: 972582,
    71: 1075701, 72: 1189756, 73: 1315908, 74: 1455440, 75: 1609773, 76: 1780476, 77: 1969287, 78: 2178128, 79: 2409124, 80: 2664626,
    81: 2947234, 82: 3259825, 83: 3605580, 84: 3988019, 85: 4411034, 86: 4878932, 87: 5396475, 88: 5968931, 89: 6602127, 90: 7302510,
    91: 8077208, 92: 8934109, 93: 9881935, 94: 10930335, 95: 12089982, 96: 13372681, 97: 14791491, 98: 16360855, 99: 18096750, 100: 20016848
  },
};

export default class SkillOrbs extends Plugin {
  // ===== PLUGIN METADATA =====
  pluginName = "Skill Orbs";
  author = "Ellz";

  
  
  // ===== PRIVATE PROPERTIES =====
  private uiManager!: UIManager;
  private domRoot: HTMLDivElement | null = null;
  private orbsRow: HTMLDivElement | null = null;
  private orbs = new Map<SkillName, OrbState>();
  private prevXp = new Map<SkillName, number>();
  private cssInjected = false;
  private lastHoverKey: string | null = null;
  private onMouseMoveBound: ((e: MouseEvent) => void) | null = null;
  private onMouseLeaveBound: ((e: MouseEvent) => void) | null = null;
  private hoverRaf = 0;
  private statsTimer?: number;
  private iconScalePct = CONSTANTS.ICON_SCALE_PCT;
  private readonly HS_BASE_CELL_PX = 24;

  // ===== SETTINGS =====
  private getDefaultSettings(): (Record<string, PluginSettings> & { enable: PluginSettings }) {
    let options: string[] = ["Whole Game Window","Up To Compass"];
    return {
      enable: {
        type: SettingsTypes.checkbox,
        text: 'Skill Orbs',
        value: true,
        callback: (v: boolean) => {
          if (!v) this.stop();
          else this.start();
        }
      },
      alignOrbs: {
        type: SettingsTypes.combobox,
        text: 'Center Align Orbs',
        value: "Whole Game Window",
        description: 'How to position orbs on the x-axis',
        options: options,
        callback: () => {if (this.orbsRow) {this.updateOrbsRowAlignment(this.orbsRow)}}

      },

      showCurrentXp: {
        type: SettingsTypes.checkbox,
        text: 'Current XP',
        value: true,
        callback: () => this.updateTooltipVisibility()
      },
      showXpToLevel: {
        type: SettingsTypes.checkbox,
        text: 'XP to Level',
        value: true,
        callback: () => this.updateTooltipVisibility()
      },
      showTimeToLevel: {
        type: SettingsTypes.checkbox,
        text: 'Time to Level',
        value: true,
        callback: () => this.updateTooltipVisibility()
      },
      showXpHr: {
        type: SettingsTypes.checkbox,
        text: 'XP/hr',
        value: true,
        callback: () => this.updateTooltipVisibility()
      },
      fadeSeconds: {
        type: SettingsTypes.range,
        text: 'Fade (seconds)',
        description: 'Min 1s, Max 600s',
        value: 5,
        min: 1,
        max: 600,
        callback: () => this.resetAllFadeTimers()
      },

        iconScaling: {
            type: SettingsTypes.range,
            text: 'Icon Scaling %',
            description: 'Min 50%, Max 90%',
            value: CONSTANTS.ICON_SCALE_PCT,
            min: 50,
            max: 90,
            callback: () => {
                this.setIconScale();
                this.updateIconSizes();
            }
        },

      orbSize: {
        type: SettingsTypes.range,
        text: 'Orb Size (px)',
        description: 'Min '+CONSTANTS.MIN_ORB_SIZE+'px, Max '+CONSTANTS.MAX_ORB_SIZE+'px.',
        value: CONSTANTS.DEFAULT_ORB_SIZE,
        min: CONSTANTS.MIN_ORB_SIZE,
        max: CONSTANTS.MAX_ORB_SIZE,
        callback: () => {
            const v = this.settings.orbSize.value;
            this.updateOrbSizes(this.toNum(v, CONSTANTS.DEFAULT_ORB_SIZE));
        }
      },

      fadeOrbs: {
        type: SettingsTypes.button,
        text: 'Clear All Orbs',
        value: 'Apply',
        callback: () => this.hideAllOrbs()
      }
    };
  }

  // ===== LIFECYCLE METHODS =====
  constructor() {
    super();

    this.uiManager = new UIManager();
    this.settings = this.getDefaultSettings();
  }

  init(): void {
    // Initialization logic if needed
  }

  start(): void {
    this.setupRoot();
    
    this.injectStyles();
    this.onMouseMoveBound = this.onMouseMove.bind(this);
    this.onMouseLeaveBound = this.onMouseLeave.bind(this);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    window.addEventListener('mouseleave', this.onMouseLeaveBound);
    
    this.refreshLayoutFromSettings();
    this.startStatsLoop();
    this.log('Skill Orbs started');
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
    this.log('Skill Orbs stopped');
  }

  // ===== GAME LOOP =====
  GameLoop_update(): void {
    if (!this.settings.enable.value) return;
    if (!this.gameHooks || !this.gameHooks.EntityManager || !this.gameHooks.EntityManager.Instance) return;
    
    const main = this.gameHooks.EntityManager.Instance.MainPlayer;
    if (!main) return;

    const resourceSkills: Skill[] = this.normalizeSkillsBag(main.Skills ? main.Skills._skills ?? main.Skills : []);
    const combatSkills: Skill[] = this.normalizeSkillsBag(main.Combat ? main.Combat._skills ?? main.Combat : []);
    const allSkills: Skill[] = resourceSkills.concat(combatSkills);
    
    if (allSkills.length === 0) return;

    const now = Date.now();
    
    for (let i = 0; i < allSkills.length; i++) {
      const s = allSkills[i];
      if (!this.isValidSkill(s)) continue;

      const skillNameLookup = (this.gameLookups && this.gameLookups['Skills'] && this.gameLookups['Skills'][s._skill]) || String(s._skill);
      const skillKey: string = skillNameLookup;

      const last = this.prevXp.has(skillKey) ? this.prevXp.get(skillKey)! : s._xp;
      const delta = s._xp - last;
      this.prevXp.set(skillKey, s._xp);
      if (delta <= 0) continue;

      const orb = this.ensureOrb(skillKey);
      const curFloor = CONSTANTS.LEVEL_TO_XP[s._level] ?? 0;
      const nextFloor = CONSTANTS.LEVEL_TO_XP[s._level + 1] ?? curFloor;
      const span = Math.max(1, nextFloor - curFloor);
      const into = Math.max(0, s._xp - curFloor);

      orb.currentLevel = s._level;
      orb.totalXp = s._xp;
      orb.progress01 = Math.min(1, into / span);
      orb.toNext = Math.max(0, nextFloor - s._xp);

      if (orb.startTs == null) {
        orb.startTs = now;
        orb.startXp = s._xp - Math.max(0, delta);
        orb._lastSampleTs = now;
        orb._lastSampleXp = s._xp;
        orb.emaXpPerHour = undefined;
      } else {
        this.updateOrbEmaFromEvent(orb, now);
      }

      orb.samples.push({ xp: s._xp, t: now });
      this.gcSamples(orb, now);
      this.refreshLayoutFromSettings();
      this.renderOrb(orb);
      this.renderOrbStatsFor(orb);
      this.resetFade(orb, now);
    }
  }

  // ===== UI MANAGEMENT =====
  private setupRoot(): void {
    this.cleanupRoot();

    const row = document.createElement('div');
    this.orbsRow = row;
    row.id = 'hl-skill-orbs';
    row.style.position = 'absolute';
    row.style.top = '6px';

    this.setupCanvasSizeMonitoring();
    this.updateOrbsRowAlignment(row);
    
    row.style.display = 'inline-flex';
    row.style.width = 'max-content';
    row.style.whiteSpace = 'nowrap';
    row.style.gap = '8px';
    row.style.pointerEvents = 'none';

    
    const mask = document.getElementById('hs-screen-mask');
    if (mask) mask.appendChild(row); else this.log('COULD NOT APPEND TO MASK');
    
  }

  private cleanupRoot(): void {
    if (this.orbsRow && this.orbsRow.parentElement) this.orbsRow.parentElement.removeChild(this.orbsRow);
    if (this.domRoot && this.domRoot.parentElement) this.domRoot.parentElement.removeChild(this.domRoot);
    this.orbsRow = null;
    this.domRoot = null;
  }

private setupCanvasSizeMonitoring() {
  const canvas = document.getElementById('hs-screen-mask');
  if (!canvas) return;
  
  let lastWidth = canvas.offsetWidth;
  
  // 1. ResizeObserver (modern browsers)
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (width !== lastWidth) {
        lastWidth = width;
        this.updateCanvasAlignment(width);
      }
    });
    resizeObserver.observe(canvas);
  } }

  private updateCanvasAlignment(width) {
    if (this.orbsRow) {
        
        this.orbsRow.style.setProperty('--canvasWidth',`${width}`);
        this.updateOrbsRowAlignment(this.orbsRow);
        
    }
    return;
    }

  private ensureOrb(skillName: string): OrbState {
    if (this.orbs.has(skillName)) return this.orbs.get(skillName)!;

    const root = document.createElement('div');
    root.style.setProperty('--size', this.getOrbSizeCss());
    root.style.setProperty('--innerScale', String(this.getInnerCoreScale()));
    root.style.setProperty('--coreOpacity', String(CONSTANTS.INNER_CORE_OPACITY)); // Add opacity variable
    root.className = 'hl-skill-orb';

    if ((document as any).highlite?.managers?.UIManager?.bindOnClickBlockHsMask) {
      (document as any).highlite.managers.UIManager.bindOnClickBlockHsMask(root, () => {});
    }

    const ring = document.createElement('div');
    ring.className = 'hl-skill-orb__ring';
    ring.style.setProperty('--thickness', String(this.getRingThickness()));

    const core = document.createElement('div');
    core.className = 'hl-skill-orb__core';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'hl-skill-orb__iconwrap';
    const iconCenter = document.createElement('div');
    iconCenter.className = 'hl-skill-orb__iconcenter';

    const icon = document.createElement('div');
    icon.classList.add(
  'hs-icon-background',
  'hs-stat-menu-item__icon',
  `hs-stat-menu-item__icon--${skillName.toLowerCase()}`
);
    icon.style.margin = '0';

    const levelBadge = document.createElement('div');
    levelBadge.className = 'hl-skill-orb__level';
    levelBadge.textContent = '1';

    const hoverMask = document.createElement('div');
    hoverMask.className = 'hl-skill-orb__mask';

    const tip = document.createElement('div');
    tip.className = 'hl-skill-orb__tip';
    tip.innerHTML = `
      <div class="hl-skill-orb__tip-header">
        <span class="tip-skill">${this.titleCase(skillName)}</span>
        <span class="tip-progress">(0.0% to Next)</span>
      </div>
      <div class="hl-skill-orb__tip-row" data-row="cur">
        <span>Current XP</span><span data-k="cur">0</span>
      </div>
      <div class="hl-skill-orb__tip-row" data-row="to">
        <span>XP to Level</span><span data-k="to">0</span>
      </div>
      <div class="hl-skill-orb__tip-row" data-row="ttl">
        <span>Time to Level</span><span data-k="ttl">NaN</span>
      </div>
      <div class="hl-skill-orb__tip-row" data-row="xphr">
        <span>XP/hr</span><span data-k="xphr">NaN</span>
      </div>
    `;

    root.appendChild(ring);
    root.appendChild(core);
    iconCenter.appendChild(icon);
    iconWrap.appendChild(iconCenter);
    root.appendChild(iconWrap);
    root.appendChild(hoverMask);
    root.appendChild(levelBadge);
    root.appendChild(tip);

    const self = this;
    root.addEventListener('mouseenter', function() {
      root.classList.add('is-hover');
      const st = self.orbs.get(skillName);
      if (st) self.pauseFade(st);
    });
    
    root.addEventListener('mouseleave', function() {
      root.classList.remove('is-hover');
      const st = self.orbs.get(skillName);
      if (st) self.resetFade(st, Date.now());
    });

    if (this.orbsRow) this.orbsRow.appendChild(root);

    const state: OrbState = {
      root, ring, core, iconWrap, iconCenter, icon, levelBadge, tooltip: tip, hoverMask,
      totalXp: 0, currentLevel: 1, toNext: 0, progress01: 0,
      samples: [], lastActivityMs: Date.now(),
    };

    requestAnimationFrame(() => this.applyIconScale(state));

    this.applyTooltipVisibility(state);
    this.orbs.set(skillName, state);
    return state;
  }

  // ===== RENDERING METHODS =====
  private renderOrb(orb: OrbState): void {
    const isMaxed = (orb.currentLevel ?? 0) >= 100;
    const prog = isMaxed ? 1 : Math.max(0, Math.min(1, orb.progress01 ?? 0));

    orb.root.style.setProperty('--ringPct', String(prog));
    const hue = Math.round(120 * prog);
    orb.root.style.setProperty('--ringColor', `hsl(${hue} 60% 45%)`);

    orb.levelBadge.textContent = String(orb.currentLevel ?? 0);
    this.renderOrbStatsFor(orb);
    this.applyTooltipVisibility(orb);
  }

  private renderOrbStatsFor(orb: OrbState): void {
    if (!orb.tooltip) return;

    const isMaxed = (orb.currentLevel ?? 0) >= 100;
    const prog = isMaxed ? 1 : Math.max(0, Math.min(1, orb.progress01 ?? 0));

    const curNode = orb.tooltip.querySelector('[data-k="cur"]') as HTMLElement | null;
    const toNode = orb.tooltip.querySelector('[data-k="to"]') as HTMLElement | null;
    const hrNode = orb.tooltip.querySelector('[data-k="xphr"]') as HTMLElement | null;
    const ttNode = orb.tooltip.querySelector('[data-k="ttl"]') as HTMLElement | null;
    const progHdr = orb.tooltip.querySelector('.tip-progress') as HTMLElement | null;

    if (progHdr) progHdr.textContent = isMaxed ? 'Maxed' : `(${(prog * 100).toFixed(1)}% to Next)`;
    if (curNode) curNode.textContent = this.formatXp(orb.totalXp);

    if (toNode) {
      const toNext = Math.max(0, Math.floor(orb.toNext ?? 0));
      toNode.textContent = isMaxed ? '' : this.formatXp(toNext);
    }

    const xphr = this.getSkillXpPerHour(orb, Date.now());
    if (hrNode) {
      hrNode.textContent = Number.isFinite(xphr) && xphr > 0
        ? abbreviateValue(Math.floor(xphr))
        : 'NaN';
    }

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

  // ===== FADE & TIMER MANAGEMENT =====
  private resetFade(orb: OrbState, now: number) {
    const seconds = this.getFadeSeconds();
    orb.lastActivityMs = now;
    
    if (orb.fadeHandle) { clearTimeout(orb.fadeHandle); orb.fadeHandle = undefined; }
    if (orb.removeHandle) { clearTimeout(orb.removeHandle); orb.removeHandle = undefined; }
    
    if (orb.isFading) {
      orb.root.classList.remove('is-fading');
      orb.isFading = false;
    }
    
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
    orb.isFading = true;
    orb.root.classList.add('is-fading');

    orb.removeHandle = window.setTimeout(() => {
      if (orb.isFading) {
        if (orb.root.parentElement) orb.root.parentElement.removeChild(orb.root);
        this.orbs.forEach((v, k) => { if (v === orb) this.orbs.delete(k); });
        orb.isFading = false;
      }
    }, 260);
  }

  private removeOrb(orb: OrbState) {
    if (orb.root.parentElement) orb.root.parentElement.removeChild(orb.root);
        this.orbs.forEach((v, k) => { if (v === orb) this.orbs.delete(k); });
        orb.isFading = false;
         if (orb.fadeHandle) { clearTimeout(orb.fadeHandle); orb.fadeHandle = undefined; }
        if (orb.removeHandle) { clearTimeout(orb.removeHandle); 
            orb.removeHandle = undefined;}
  }

  private resetAllFadeTimers(): void {
    const now = Date.now();
    this.orbs.forEach(o => this.resetFade(o, now));
  }

  private hideAllOrbs(): void {
    this.orbs.forEach(o => {this.removeOrb(o)});
    this.refreshLayoutFromSettings();
  }

  // ===== SETTINGS-DRIVEN UPDATES =====
  private refreshLayoutFromSettings(): void {
    if (this.orbsRow) this.updateOrbsRowAlignment(this.orbsRow);
    this.updateOrbSizes(this.getOrbSize());
    this.updateTooltipVisibility();
    this.updateIconSizes();
    this.resetAllFadeTimers();
  }

  private updateTooltipVisibility(): void {
    this.orbs.forEach((orb) => this.applyTooltipVisibility(orb));
  }

  private applyTooltipVisibility(orb: OrbState): void {
    if (!orb || !orb.tooltip) return;

    const isMaxed = (orb.currentLevel ?? 0) >= 100;
    const curRow = orb.tooltip.querySelector('[data-row="cur"]') as HTMLElement | null;
    const toRow = orb.tooltip.querySelector('[data-row="to"]') as HTMLElement | null;
    const ttlRow = orb.tooltip.querySelector('[data-row="ttl"]') as HTMLElement | null;
    const hrRow = orb.tooltip.querySelector('[data-row="xphr"]') as HTMLElement | null;

    if (curRow) curRow.classList.toggle('is-hidden', !this.isSettingOn('showCurrentXp'));
    
    const showTo = this.isSettingOn('showXpToLevel') && !isMaxed;
    if (toRow) toRow.classList.toggle('is-hidden', !showTo);

    const showTTL = this.isSettingOn('showTimeToLevel') && !isMaxed;
    if (ttlRow) ttlRow.classList.toggle('is-hidden', !showTTL);

    if (hrRow) hrRow.classList.toggle('is-hidden', !this.isSettingOn('showXpHr'));
  }

  private applyIconScale(orb: OrbState): void {
    if (!orb.icon) return;
    const innerPx = Math.floor(this.getOrbSize() * this.getInnerCoreScale());
    const target  = Math.floor(innerPx * this.getIconScaleInt());   // small inset
    const scale   = target / this.HS_BASE_CELL_PX;
    orb.icon.style.setProperty('--iconScale', scale.toFixed(3));
}

  private applyOrbScale(orb: OrbState,size): void {
    orb.root.style.setProperty('--size', size + 'px');
    const scale = size / CONSTANTS.DEFAULT_ORB_SIZE;
    orb.iconWrap.style.setProperty('--orbScale', scale.toFixed(3));

  }

  private updateOrbSizes(n: unknown): void {
    const size = typeof n === 'number' ? n : this.getOrbSize();
    this.orbs.forEach(o => this.applyOrbScale(o,size));
    this.updateIconSizes();
  }

  private updateIconSizes(): void {
    this.orbs.forEach(o => this.applyIconScale(o));
    }

  private updateOrbsRowAlignment(orbsRow : HTMLDivElement): void {
    
    if (this.settings.alignOrbs.value == "Whole Game Window") {
        orbsRow.style.left = '50%';
        orbsRow.style.transform = 'translateX(-50%)';
        orbsRow.classList.remove('align-compass');
        }
    else if (this.settings.alignOrbs.value == "Up To Compass") {
        const canvasWidth = parseFloat(orbsRow.style.getPropertyValue('--canvasWidth'));
        const compassRight = 212
        const offset = (canvasWidth - compassRight) / 2;
          orbsRow.style.left = `${offset}px`; // Use the CSS variable
    orbsRow.style.transform = 'translateX(-50%)';
    orbsRow.classList.add('align-compass');}
    return;
  }

  

  // ===== STATS & CALCULATIONS =====
  private startStatsLoop(): void {
    if (this.statsTimer) return;
    this.statsTimer = window.setInterval(() => {
      const now = Date.now();
      this.orbs.forEach(orb => this.updateOrbEmaFromEvent(orb, now));
      this.orbs.forEach(orb => this.renderOrbStatsFor(orb));
    }, 1000);
    this.refreshLayoutFromSettings();
  }

  private stopStatsLoop(): void {
    if (!this.statsTimer) return;
    clearInterval(this.statsTimer);
    this.statsTimer = undefined;
  }

  private gcSamples(orb: OrbState, now: number) {
    const cutoff = now - 5 * 60_000;
    while (orb.samples.length > 0 && orb.samples[0].t < cutoff) orb.samples.shift();
  }

  private updateOrbEmaFromEvent(orb: OrbState, nowMs: number): void {
    if (orb._lastSampleTs == null || orb._lastSampleXp == null) {
      orb._lastSampleTs = nowMs;
      orb._lastSampleXp = orb.totalXp ?? 0;
      return;
    }
    
    const dtMs = nowMs - orb._lastSampleTs;
    if (dtMs < 250) return;

    const dxp = (orb.totalXp ?? 0) - orb._lastSampleXp;
    const hours = dtMs / 3_600_000;
    const inst = hours > 0 ? (dxp / hours) : NaN;

    const alpha = Math.max(0, Math.min(1, dtMs / (CONSTANTS.EMA_TAU_SECONDS * 1000)));

    if (Number.isFinite(inst)) {
      orb.emaXpPerHour = (orb.emaXpPerHour == null)
        ? inst
        : (alpha * inst + (1 - alpha) * orb.emaXpPerHour);
    }

    orb._lastSampleTs = nowMs;
    orb._lastSampleXp = orb.totalXp ?? 0;
  }

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

  // ===== EVENT HANDLERS =====
  private onMouseMove(e: MouseEvent): void {
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
          this.resetFade(prev, Date.now());
        }
        
        if (hoveredKey && this.orbs.has(hoveredKey)) {
          const cur = this.orbs.get(hoveredKey)!;
          cur.root.classList.add('is-hover');
          this.pauseFade(cur);
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

  // ===== HELPER METHODS =====
  private injectStyles(): void {
    if (this.cssInjected) return;
    
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.appendChild(style);
    
    this.cssInjected = true;
  }

  private isValidSkill(x: any): x is { _skill: number; _level: number; _xp: number } {
    return !!x && typeof x._skill === 'number' && typeof x._level === 'number' && typeof x._xp === 'number';
  }

  private normalizeSkillsBag(bag: any): Skill[] {
    if (!bag) return [];
    
    const maybeArr = Array.isArray(bag) ? bag : Array.isArray(bag._skills) ? bag._skills : bag;

    if (Array.isArray(maybeArr)) {
      return maybeArr.filter((e) => this.isValidSkill(e));
    }

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

  private isSettingOn(key: keyof typeof this.settings): boolean {
    const s = this.settings[key as string];
    return !!(s && typeof s.value !== 'undefined' && s.value);
  }



  // ===== GETTER METHODS =====

  private getIconScaleInt(): number { return this.iconScalePct / 100; }
  private getInnerCoreScale(): number { return CONSTANTS.INNER_CORE_SCALE_INT / 100; }
  private getRingThickness(): number { return CONSTANTS.RING_THICKNESS_INT / 100; }
  private getOrbSize(): number { return this.toNum(this.settings.orbSize.value, CONSTANTS.DEFAULT_ORB_SIZE); }
  private getOrbSizeCss(): string { return this.getOrbSize() + 'px'; }
  private getFadeSeconds(): number { return this.toNum(this.settings.fadeSeconds.value, 5); }

  private setIconScale(percent?: number): any {
    
    if (!percent) {
        const value = this.settings.iconScaling.value;
        percent = this.toNum(value,CONSTANTS.ICON_SCALE_PCT)
    }
    if ((percent >= 50) && (percent <= 90)){
        this.iconScalePct = percent}
    return;
  }

  // ===== UTILITY METHODS =====
  private toNum(v: unknown, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  private formatXp(n: number | undefined): string {
    const v = Math.max(0, Math.floor(n ?? 0));
    return v.toLocaleString("en-US");
  }

  private formatHMS(totalSeconds: number): string {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 'NaN';
    const s = Math.floor(totalSeconds % 60);
    const m = Math.floor((totalSeconds / 60) % 60);
    const h = Math.floor(totalSeconds / 3600);
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    return `${h}:${mm}:${ss}`;
  }

  private titleCase(s: string): string {
    return s.replace(/\b\w/g, m => m.toUpperCase());
  }

  private resetSettingsToDefaults(): void {
    const d = this.getDefaultSettings();
    for (const k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      if (!this.settings[k]) this.settings[k] = d[k];
      else this.settings[k].value = d[k].value;
    }
    this.refreshLayoutFromSettings();
  }
}
