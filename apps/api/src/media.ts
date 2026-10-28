import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { PixelGrid } from '@splint/shared';
import type { Config } from './config.js';
import { digest } from './crypto.js';

export interface MediaStore { get(key: string): Promise<Buffer>; put(key: string, bytes: Buffer, contentType: string): Promise<void> }
export class LocalMediaStore implements MediaStore {
  constructor(private directory: string) {}
  private path(key: string) {
    if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(key) || key.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid media key.');
    return resolve(this.directory, key);
  }
  async get(key: string) { return readFile(this.path(key)); }
  async put(key: string, bytes: Buffer) { const path = this.path(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: 'wx' }).catch(async error => { if (error.code !== 'EEXIST') throw error; if (digest(await readFile(path)) !== digest(bytes)) throw new Error('Immutable media conflict.'); }); }
}
export class R2MediaStore implements MediaStore {
  private s3: S3Client;
  constructor(private config: NonNullable<Config['r2']>) {
    this.s3 = new S3Client({ region: 'auto', endpoint: config.endpoint, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 3 });
  }
  async get(key: string) { const response = await this.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key })); if (!response.Body) throw new Error('Missing media.'); return Buffer.from(await response.Body.transformToByteArray()); }
  async put(key: string, bytes: Buffer, contentType: string) { await this.s3.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: contentType, CacheControl: 'private, no-store', IfNoneMatch: '*' })).catch(async error => { if (error.$metadata?.httpStatusCode !== 412) throw error; if (digest(await this.get(key)) !== digest(bytes)) throw new Error('Immutable media conflict.'); }); }
}
export function createMediaStore(config: Config): MediaStore { return config.storageMode === 'r2' ? new R2MediaStore(config.r2!) : new LocalMediaStore(config.localMediaDir); }
export function validateGrid(grid: PixelGrid): void {
  if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 1 || grid.height < 1 || grid.width > 256 || grid.height > 256 || !Array.isArray(grid.palette) || grid.palette.length < 1 || grid.palette.length > 256 || grid.palette.some(color => !/^#[0-9a-f]{6}$/i.test(color)) || !Array.isArray(grid.cells) || grid.cells.length !== grid.width * grid.height || !Array.isArray(grid.mask) || grid.mask.length !== grid.cells.length || grid.cells.some(color => !Number.isInteger(color) || color < 0 || color >= grid.palette.length) || grid.mask.some(value => typeof value !== 'boolean') || !grid.mask.some(Boolean)) throw new Error('Invalid canonical grid.');
}
export async function loadGrid(store: MediaStore, key: string, hash: string): Promise<PixelGrid> { const bytes = await store.get(key); if (digest(bytes) !== hash) throw new Error('Canonical grid integrity check failed.'); const grid = JSON.parse(bytes.toString('utf8')) as PixelGrid; validateGrid(grid); return grid; }
const escapeXml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
export async function renderPng(grid: PixelGrid, attribution?: string): Promise<Buffer> {
  const pixels = Buffer.alloc(grid.width * grid.height * 4);
  grid.cells.forEach((color, index) => { const hex = grid.palette[color]!; pixels[index * 4] = parseInt(hex.slice(1, 3), 16); pixels[index * 4 + 1] = parseInt(hex.slice(3, 5), 16); pixels[index * 4 + 2] = parseInt(hex.slice(5, 7), 16); pixels[index * 4 + 3] = grid.mask[index] ? 255 : 0; });
  const width = 640; const height = Math.round(width * grid.height / grid.width);
  let image = sharp(pixels, { raw: { width: grid.width, height: grid.height, channels: 4 } }).resize(width, height, { kernel: 'nearest' }).flatten({ background: '#faf7f1' });
  if (attribution) { image = image.extend({ bottom: 64, background: '#faf7f1' }).composite([{ input: Buffer.from(`<svg width="640" height="64" xmlns="http://www.w3.org/2000/svg"><text x="20" y="28" font-family="sans-serif" font-size="14" fill="#334139">${escapeXml(attribution.slice(0, 85))}</text><text x="20" y="50" font-family="sans-serif" font-size="12" fill="#58665c">Splint · Pixel by pixel</text></svg>`), left: 0, top: height }]); }
  return image.png().toBuffer();
}
