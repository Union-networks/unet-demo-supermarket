export type ProductRecord = {
  productId: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  unit: string;
  imageEmoji: string;
  requiresChecks?: string[];
};

export type BasketItem = {
  productId: string;
  quantity: number;
};

export type AccountState = {
  favorites: string[];
  basket: BasketItem[];
};

export type SessionState = {
  scopedUserId: string;
  assertionJws: string;
  sessionId?: string;
};

export type HostMessage = {
  id?: string;
  source?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
};
