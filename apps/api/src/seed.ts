import type pg from 'pg';
import { demoArtworks, type DemoArtwork } from '@splint/shared';
import { transaction } from './db.js';
import { digest } from './crypto.js';
import { validateGrid, type MediaStore } from './media.js';

export async function seedCatalog(pool: pg.Pool, media: MediaStore, artworks: readonly DemoArtwork[] = demoArtworks): Promise<void> {
  for (const work of artworks) {
    validateGrid(work.grid);
    const bytes = Buffer.from(JSON.stringify(work.grid)); const hash = digest(bytes);
    const key = `canonical/${work.versionId}-${hash}.json`;
    await transaction(pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`seed:${work.id}`]);
      const existing = (await client.query('SELECT version_id,grid_key,grid_sha256 FROM artworks WHERE id=$1 FOR SHARE', [work.id])).rows[0];
      if (existing && (existing.grid_sha256 !== hash || existing.version_id !== work.versionId)) throw new Error('Existing artwork differs; seed refuses replacement.');
      // Ensure immutable bytes even when metadata exists: restoring/changing a
      // storage destination must not leave otherwise valid catalogue rows broken.
      await media.put(existing?.grid_key || key, bytes, 'application/json');
      if (existing) return;
      await client.query('INSERT INTO artworks(id,version_id,title,description,author,category,width,height,color_count,total,grid_key,grid_sha256,featured,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [work.id, work.versionId, work.title, work.description, work.author, work.category, work.grid.width, work.grid.height, work.grid.palette.length, work.grid.mask.filter(Boolean).length, key, hash, work.featured, work.publishedAt]);
    });
  }
}
