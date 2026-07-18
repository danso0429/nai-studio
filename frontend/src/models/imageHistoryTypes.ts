export interface GenerationHistoryEntry {
  id: string;
  sessionName: string;
  sceneType: 'scene' | 'inpaint';
  sceneName: string;
  filename: string;
  path: string;
  createdAt: number;
}
