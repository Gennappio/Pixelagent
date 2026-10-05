// Placeholder characters drawn from rectangles. Swap for real sprite sheets later;
// nothing outside world/ depends on how a sprite is drawn.

export interface SpritePalette {
  label: string;
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  longHair: boolean;
}

export const SPRITES: Record<string, SpritePalette> = {
  agent_female_01: { label: "Red jacket", skin: 0xf1c9a5, hair: 0x8b3a2f, shirt: 0xd1495b, pants: 0x2e4057, longHair: true },
  agent_female_02: { label: "Purple jumper", skin: 0xe0ac86, hair: 0x26222b, shirt: 0x8e6bbf, pants: 0x2f3247, longHair: true },
  agent_male_01: { label: "Blue shirt", skin: 0xf1c9a5, hair: 0x4a3728, shirt: 0x3a86c8, pants: 0x33384d, longHair: false },
  agent_male_02: { label: "Green shirt", skin: 0xc98f66, hair: 0x1d1d1d, shirt: 0x3fa66b, pants: 0x3b3440, longHair: false },
  agent_robot_01: { label: "Robot", skin: 0xb8c4d0, hair: 0x6b7785, shirt: 0x8792a2, pants: 0x4d5562, longHair: false },
};

export const DEFAULT_SPRITE = "agent_male_01";

export function spriteFor(id: string): SpritePalette {
  return SPRITES[id] ?? SPRITES[DEFAULT_SPRITE];
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
