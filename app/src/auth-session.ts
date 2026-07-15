type TokenProvider = () => Promise<string | null>;

let hosted = false;
let userId: string | null = null;
let tokenProvider: TokenProvider = async () => null;

export function configureHostedSession(next: {
  hosted: boolean;
  userId: string | null;
  getToken?: TokenProvider;
}): void {
  hosted = next.hosted;
  userId = next.userId;
  tokenProvider = next.getToken ?? (async () => null);
}

export function isHostedSession(): boolean {
  return hosted;
}

export function currentUserId(): string | null {
  return userId;
}

export async function authHeaders(): Promise<Record<string, string>> {
  if (!hosted) return {};
  const token = await tokenProvider();
  return token ? { authorization: `Bearer ${token}` } : {};
}
