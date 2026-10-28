import type { DemoArtwork, PixelGrid } from './index.js';

// Original Splint artwork, authored as deterministic pixel compositions.
// No external image service, stock asset or user photograph is used.
class Pixels {
  cells: number[];
  constructor(readonly size: number, readonly palette: string[], background = 0) {
    this.cells = Array(size * size).fill(background);
  }
  dot(x: number, y: number, c: number) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.size && y < this.size) this.cells[y * this.size + x] = c;
    return this;
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) this.dot(px, py, c);
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number) {
    for (let y = Math.ceil(cy - ry); y <= cy + ry; y++)
      for (let x = Math.ceil(cx - rx); x <= cx + rx; x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.dot(x, y, c);
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number, c: number) {
    const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= n; i++) this.dot(x1 + (x2 - x1) * i / (n || 1), y1 + (y2 - y1) * i / (n || 1), c);
    return this;
  }
  triangle(x: number, y: number, half: number, height: number, c: number) {
    for (let dy = 0; dy < height; dy++) {
      const span = Math.floor(half * dy / Math.max(1, height - 1));
      this.rect(x - span, y + dy, span * 2 + 1, 1, c);
    }
    return this;
  }
  star(x: number, y: number, c: number) {
    return this.dot(x, y, c).dot(x - 1, y, c).dot(x + 1, y, c).dot(x, y - 1, c).dot(x, y + 1, c);
  }
  grid(): PixelGrid {
    // Compact the palette so the UI never displays a color absent from the image.
    const used = this.palette.map((_, i) => i).filter(i => this.cells.includes(i));
    return { width: this.size, height: this.size, palette: used.map(i => this.palette[i]),
      cells: this.cells.map(i => used.indexOf(i)), mask: this.cells.map(() => true) };
  }
}

function moonGarden() {
  const p = new Pixels(32, ['#282845','#43405F','#716189','#BE98B8','#EDD4C9','#FFF0CD','#49656A','#769D87','#B2C99E','#D7A17E']);
  p.rect(0, 20, 32, 12, 1).ellipse(22, 8, 5, 5, 5).ellipse(25, 6, 4, 4, 0);
  p.star(7, 5, 4).dot(14, 3, 5).dot(5, 13, 3).star(27, 17, 3).dot(16, 11, 4);
  p.rect(0, 26, 32, 6, 6).ellipse(15, 28, 9, 3, 2).ellipse(15, 28, 6, 2, 3);
  p.line(7, 27, 7, 17, 7).ellipse(5, 22, 3, 1, 8).ellipse(9, 19, 3, 1, 7);
  p.line(24, 28, 24, 19, 7).ellipse(26, 23, 3, 1, 8).ellipse(22, 26, 3, 1, 7);
  p.rect(11, 20, 7, 5, 9).rect(12, 19, 5, 1, 4).rect(13, 17, 3, 3, 4);
  p.dot(12, 16, 3).dot(16, 15, 3).rect(10, 25, 9, 1, 5);
  return p.grid();
}

function coast() {
  const p = new Pixels(24, ['#F2CCB5','#EDAE94','#F8E8C1','#B6849C','#706B98','#4C7D91','#7CA8AB','#B6CFBD','#354D6B']);
  p.rect(0, 9, 24, 4, 1).ellipse(16, 9, 4, 4, 2);
  p.triangle(2, 7, 8, 10, 3).triangle(7, 11, 6, 6, 4).triangle(23, 10, 7, 7, 4);
  p.rect(0, 16, 24, 8, 5).rect(0, 20, 24, 4, 6);
  p.rect(12, 16, 7, 1, 2).rect(14, 18, 4, 1, 1).rect(10, 20, 8, 1, 7).rect(15, 22, 6, 1, 7);
  p.rect(2, 19, 5, 1, 8).rect(3, 20, 3, 1, 8).line(5, 14, 5, 18, 8).triangle(4, 14, 1, 4, 2);
  p.line(3, 5, 4, 6, 4).line(4, 6, 5, 5, 4).line(9, 3, 10, 4, 4).line(10, 4, 11, 3, 4);
  return p.grid();
}

function fox() {
  const p = new Pixels(24, ['#EDE0C4','#D5C7A9','#819C83','#557C69','#BD663D','#E79457','#F4C88F','#FFF0CE','#473F43']);
  p.rect(0, 19, 24, 5, 2).ellipse(11, 20, 10, 2, 3);
  p.line(3, 18, 3, 7, 3).ellipse(2, 11, 2, 3, 2).ellipse(5, 15, 2, 2, 2);
  p.line(21, 18, 21, 6, 3).ellipse(20, 9, 2, 3, 2).ellipse(22, 14, 2, 2, 2);
  p.ellipse(12, 16, 7, 4, 4).ellipse(13, 15, 6, 3, 5).ellipse(15, 18, 5, 2, 6);
  p.triangle(8, 7, 2, 6, 4).triangle(14, 7, 2, 6, 4).triangle(8, 9, 1, 3, 7).triangle(14, 9, 1, 3, 7);
  p.ellipse(11, 13, 5, 4, 5).ellipse(9, 15, 3, 2, 7).ellipse(13, 15, 3, 2, 7);
  p.rect(7, 12, 2, 1, 8).rect(13, 12, 2, 1, 8).dot(11, 15, 8);
  p.ellipse(18, 18, 3, 2, 7).dot(2, 21, 7).dot(22, 20, 6);
  return p.grid();
}

function orbit() {
  const p = new Pixels(24, ['#282D48','#44456B','#73638E','#C7AACB','#E9D5D3','#FFF2CC','#EAB28E','#87B9AE']);
  p.star(4, 5, 5).star(19, 4, 3).dot(10, 2, 4).dot(3, 16, 3).dot(21, 17, 5).dot(8, 21, 4);
  p.ellipse(12, 12, 8, 2, 2).ellipse(12, 12, 5, 5, 6);
  p.rect(9, 8, 5, 1, 5).rect(8, 10, 8, 1, 4).rect(10, 13, 7, 1, 2).rect(10, 15, 5, 1, 4);
  p.line(3, 15, 20, 10, 3).line(4, 16, 21, 11, 4).dot(2, 15, 3).dot(21, 10, 3);
  p.ellipse(18, 20, 2, 2, 7).dot(17, 19, 5);
  return p.grid();
}

function matcha() {
  const p = new Pixels(16, ['#F1E8D5','#D8CEB7','#A9B98D','#68886B','#3C6659','#FFF8E8','#D29B76']);
  p.rect(0, 12, 16, 4, 1).ellipse(7, 13, 6, 1, 6);
  p.ellipse(12, 8, 2, 3, 4).ellipse(12, 8, 1, 1, 0);
  p.rect(3, 6, 8, 5, 3).rect(4, 11, 6, 1, 4).rect(3, 6, 8, 1, 5).rect(4, 7, 6, 1, 2);
  p.rect(4, 8, 1, 3, 2).line(5, 4, 6, 3, 5).dot(5, 2, 5).line(8, 4, 9, 3, 5).dot(8, 1, 5);
  return p.grid();
}

function rain() {
  const p = new Pixels(24, ['#D2D7D6','#AABFC0','#77969F','#59687D','#9A7A93','#E1A1A0','#F3C6AF','#EEE7D2']);
  p.rect(0, 19, 24, 5, 2).ellipse(12, 22, 8, 1, 1);
  for (const [x, y] of [[2, 3], [7, 1], [18, 2], [22, 7], [2, 13], [20, 14], [5, 8], [15, 0]]) p.line(x, y, x - 1, y + 2, 1);
  p.ellipse(12, 11, 8, 6, 4).ellipse(12, 11, 5, 6, 5).ellipse(12, 11, 2, 6, 6);
  p.rect(3, 12, 18, 7, 0).line(12, 12, 12, 18, 3).dot(11, 19, 3).dot(10, 18, 3);
  p.rect(5, 11, 4, 1, 7).rect(10, 11, 5, 1, 7).rect(16, 11, 4, 1, 7);
  p.rect(6, 20, 4, 1, 7).rect(15, 22, 5, 1, 7);
  return p.grid();
}

function cat() {
  const p = new Pixels(24, ['#F2DDBF','#D4AA8B','#7E8F9A','#BAC9C3','#F5EBD5','#5E5260','#9E7980','#E2B0A0']);
  p.rect(3, 2, 18, 16, 5).rect(4, 3, 16, 14, 2).rect(5, 4, 6, 5, 3).rect(13, 4, 6, 5, 3);
  p.rect(5, 11, 6, 5, 3).rect(13, 11, 6, 5, 3).rect(2, 18, 20, 2, 1).rect(0, 20, 24, 4, 7);
  p.ellipse(12, 16, 4, 4, 5).triangle(9, 8, 2, 5, 5).triangle(15, 8, 2, 5, 5).ellipse(12, 12, 5, 3, 5);
  p.dot(9, 11, 4).dot(15, 11, 4).dot(12, 13, 7).rect(11, 16, 2, 4, 4);
  p.line(15, 18, 20, 16, 5).line(20, 16, 20, 13, 5).dot(19, 12, 5);
  p.rect(5, 20, 4, 1, 4).rect(15, 22, 4, 1, 1);
  return p.grid();
}

function mushroom() {
  const p = new Pixels(16, ['#E4E9D7','#9FB68C','#557A63','#E6C69E','#C97564','#944E58','#FFF0D4']);
  p.rect(0, 13, 16, 3, 1).line(2, 13, 1, 10, 2).line(13, 14, 14, 11, 2);
  p.rect(6, 8, 4, 5, 3).rect(6, 12, 5, 1, 6);
  p.ellipse(8, 7, 6, 4, 4).rect(2, 8, 13, 2, 5).rect(3, 8, 11, 1, 6);
  p.rect(6, 4, 2, 2, 6).rect(10, 6, 2, 1, 6).dot(4, 7, 6).dot(9, 3, 6);
  p.dot(3, 14, 6).dot(12, 13, 4);
  return p.grid();
}

const definitions: Array<[string, string, string, string, () => PixelGrid]> = [
  ['moon-garden', 'Лунный сад', 'Тихая ночь, теплый чай и несколько звезд для себя.', 'Атмосфера', moonGarden],
  ['quiet-coast', 'Тихий берег', 'Последние лучи солнца отражаются в спокойной воде.', 'Природа', coast],
  ['sleepy-fox', 'Лисий сон', 'Маленькая пауза посреди большого леса.', 'Животные', fox],
  ['little-orbit', 'Своя орбита', 'У каждой маленькой планеты есть своя история.', 'Космос', orbit],
  ['matcha-moment', 'Матча-пауза', 'Шестнадцать пикселей уюта и никуда не нужно спешить.', 'Уют', matcha],
  ['warm-rain', 'Теплый дождь', 'Когда пасмурный день тоже может быть красивым.', 'Атмосфера', rain],
  ['window-cat', 'Кот у окна', 'Лучшее место, чтобы смотреть, как проходит день.', 'Животные', cat],
  ['forest-secret', 'Лесной секрет', 'Небольшое чудо прячется среди травы.', 'Природа', mushroom],
];

export const demoArtworks: DemoArtwork[] = definitions.map(([id, title, description, category, draw], i) => ({
  id, versionId: `${id}-v1`, title, description, category, author: 'Splint Studio',
  featured: i < 3, publishedAt: `2026-10-${String(28 - i).padStart(2, '0')}T12:00:00.000Z`, grid: draw(),
}));
