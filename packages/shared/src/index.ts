export interface PixelGrid {
  width: number;
  height: number;
  palette: string[];
  cells: number[];
  mask: boolean[];
}

export interface ArtworkSummary {
  id: string;
  versionId: string;
  title: string;
  description: string;
  author: string;
  width: number;
  height: number;
  colorCount: number;
  previewUrl: string;
  category: string;
  status: 'available' | 'in_progress' | 'completed';
  progress: number;
  runId?: string;
  featured: boolean;
  publishedAt: string;
}

export interface RunState {
  id: string;
  workId: string;
  versionId: string;
  status: 'active' | 'completed' | 'interrupted';
  filled: number[];
  total: number;
  progress: number;
  revision: number;
  completedAt: string | null;
}

export interface LibraryItem { work: ArtworkSummary; run: RunState; }

export interface SessionResponse {
  user: {
    id: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
    notifications: boolean;
    shareName: boolean;
  };
  csrfToken: string;
  accessToken?: string;
  consentRequired: boolean;
  mode: 'telegram' | 'demo';
}

export interface DemoArtwork {
  id: string;
  versionId: string;
  title: string;
  description: string;
  author: string;
  category: string;
  featured: boolean;
  publishedAt: string;
  grid: PixelGrid;
}

export { demoArtworks } from './artworks.js';
