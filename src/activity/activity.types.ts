export interface ApiActivityEvent {
  id: number;
  type: string;
  message: string;
  details: unknown;
  author: string | null;
  created_at: string;
}
