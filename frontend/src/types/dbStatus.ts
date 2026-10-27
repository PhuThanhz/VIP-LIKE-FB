export interface DbStatus {
  connected: boolean;
  usingCache?: boolean;
  cachedCount?: number;
  loading: boolean;
  database?: string;
  error?: string;
}
