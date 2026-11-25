export interface DbStatus {
  connected: boolean;
  usingCache?: boolean;
  cachedCount?: number;
  loading: boolean;
  database?: string;
  driver?: 'mysql' | 'sqlite';
  error?: string;
}
