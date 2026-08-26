"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { SERVICE_ID } from "../lib/config";
import { PRODUCTS } from "../lib/products";
import type { AccountState, HostMessage, ProductRecord, SessionState } from "../lib/types";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    __unetReceiveHostMessage?: (message: HostMessage) => void;
  }
}

type PendingHostRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type ActiveAgeCheck = {
  requestType: string;
  label?: string;
};

const sessionKey = "unet.demoSupermarket.session.v3";
const stateKey = (scopedUserId: string) => `unet.demoSupermarket.state.v1.${scopedUserId}`;
const emptyState: AccountState = { favorites: [], basket: [] };
type CheckoutVerificationResponse = {
  requiresVerification?: boolean;
  checkout?: { checkoutId: string; status: string; failureReason?: string };
  verification?: { qrDataUrl?: string };
  message?: string;
};

const createCheckoutVerification = async (input: { requiredChecks: string[]; restrictedResourceIds: string[]; ttlSeconds: number }): Promise<CheckoutVerificationResponse> => {
  const response = await fetch('/api/checkout-verifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({})) as CheckoutVerificationResponse;
  if (!response.ok) throw new Error(payload.message ?? `Checkout verification failed (${response.status}).`);
  return payload;
};

const pollCheckoutVerification = async (checkoutId: string): Promise<CheckoutVerificationResponse> => {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/checkout-verifications/${encodeURIComponent(checkoutId)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({})) as CheckoutVerificationResponse;
    if (!response.ok) throw new Error(payload.message ?? `Checkout verification failed (${response.status}).`);
    if (payload.checkout?.status !== 'pending_verification') return payload;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Checkout verification expired.');
};

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`;

function readMiniAppMode() {
  if (typeof window === "undefined") return false;
  return Boolean(window.ReactNativeWebView) || new URLSearchParams(window.location.search).get("miniapp") === "1";
}

function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as HostMessage;
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object") return data as HostMessage;
  return null;
}

export function SupermarketApp() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [state, setState] = useState<AccountState>(emptyState);
  const [session, setSession] = useState<SessionState | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("Sign in to favorite items and use your basket.");
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginQr, setLoginQr] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState("Scan with U-net and approve on your phone.");
  const [verifyQr, setVerifyQr] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [verifyTone, setVerifyTone] = useState<"neutral" | "success" | "warning" | "error">("neutral");
  const [miniAppMode, setMiniAppMode] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [ageCheck, setAgeCheck] = useState<ActiveAgeCheck | null>(null);
  const hostSeq = useRef(0);
  const pendingHost = useRef(new Map<string, PendingHostRequest>());

  const categories = useMemo(() => ["All", ...Array.from(new Set(products.map((product) => product.category)))], [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const haystack = `${product.name} ${product.category} ${product.description}`.toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [category, products, search]);

  const basketLines = useMemo(
    () =>
      state.basket
        .map((item) => ({ ...item, product: products.find((product) => product.productId === item.productId) }))
        .filter((item): item is { productId: string; quantity: number; product: ProductRecord } => Boolean(item.product)),
    [products, state.basket],
  );

  const favoriteProducts = useMemo(
    () => state.favorites.map((id) => products.find((product) => product.productId === id)).filter(Boolean) as ProductRecord[],
    [products, state.favorites],
  );

  const totalCents = basketLines.reduce((sum, item) => sum + item.quantity * item.product.priceCents, 0);

  const basketQuantity = useCallback(
    (productId: string) => state.basket.find((item) => item.productId === productId)?.quantity || 0,
    [state.basket],
  );

  const saveSession = useCallback((next: SessionState | null) => {
    setSession(next);
    if (next) window.localStorage.setItem(sessionKey, JSON.stringify(next));
    else window.localStorage.removeItem(sessionKey);
  }, []);

  const loadProducts = useCallback(async () => {
    setProducts(PRODUCTS);
  }, []);

  const loadAgeCheck = useCallback(async () => {
    const response = await fetch("/api/verification-checks", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as { check?: ActiveAgeCheck; message?: string };
    if (!response.ok || !body.check?.requestType) {
      throw new Error(body.message || "No active over-18 attestation check is available.");
    }
    setAgeCheck(body.check);
  }, []);

  const loadState = useCallback(async () => {
    if (!session?.scopedUserId) return;
    try {
      setState(JSON.parse(window.localStorage.getItem(stateKey(session.scopedUserId)) || "null") as AccountState || emptyState);
    } catch {
      setState(emptyState);
    }
  }, [session?.scopedUserId]);

  const saveAccountState = useCallback((next: AccountState) => {
    setState(next);
    if (session?.scopedUserId) window.localStorage.setItem(stateKey(session.scopedUserId), JSON.stringify(next));
  }, [session?.scopedUserId]);

  const hasHostBridge = useCallback(
    () => Boolean(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function"),
    [],
  );

  const waitForHostBridge = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        if (hasHostBridge()) {
          resolve();
          return;
        }
        const startedAt = Date.now();
        const tick = () => {
          if (hasHostBridge()) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 8000) {
            reject(new Error("Open this inside the U-net app to auto-connect."));
            return;
          }
          setTimeout(tick, 80);
        };
        tick();
      }),
    [hasHostBridge],
  );

  const callHost = useCallback(
    async <T,>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
      await waitForHostBridge();
      return new Promise<T>((resolve, reject) => {
        const id = `supermarket-${++hostSeq.current}`;
        const timeoutMs = action === "host.requestVerification" ? 180000 : 30000;
        const timeout = setTimeout(() => {
          pendingHost.current.delete(id);
          reject(new Error("U-net host did not respond."));
        }, timeoutMs);
        pendingHost.current.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
          timeout,
        });
        window.ReactNativeWebView?.postMessage(JSON.stringify({ id, action, payload }));
      });
    },
    [waitForHostBridge],
  );

  const connectMiniAppSession = useCallback(async () => {
    setMiniAppMode(true);
    setStatus("Connecting to U-net...");
    const created = await callHost<{ scopedUserId?: string; sessionId?: string }>("host.createServiceSession");
    if (!created.scopedUserId || !created.sessionId) throw new Error("U-net host did not return a provider session.");
    const response = await fetch("/api/unet/login/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.sessionId }),
    });
    const exchanged = await response.json().catch(() => ({})) as { success?: boolean; message?: string };
    if (!response.ok || !exchanged.success) throw new Error(exchanged.message || "Provider session exchange failed.");
    saveSession({ scopedUserId: created.scopedUserId, sessionId: created.sessionId });
    setStatus("Connected through the U-net app. This shop only knows your supermarket-scoped ID.");
  }, [callHost, saveSession]);

  useEffect(() => {
    window.__unetReceiveHostMessage = (message: HostMessage) => {
      if (!message || message.source !== "unet-host" || !message.id) return;
      const pending = pendingHost.current.get(message.id);
      if (!pending) return;
      pendingHost.current.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "U-net host request failed."));
    };
    const listener = (event: MessageEvent) => {
      const message = parseHostMessage(event.data);
      if (message) window.__unetReceiveHostMessage?.(message);
    };
    window.addEventListener("message", listener);
    document.addEventListener("message", listener as EventListener);
    return () => {
      window.removeEventListener("message", listener);
      document.removeEventListener("message", listener as EventListener);
      delete window.__unetReceiveHostMessage;
      pendingHost.current.forEach((pending) => clearTimeout(pending.timeout));
      pendingHost.current.clear();
    };
  }, []);

  useEffect(() => {
    setMiniAppMode(readMiniAppMode());
    try {
      const stored = JSON.parse(window.localStorage.getItem(sessionKey) || "null") as SessionState | null;
      if (stored?.scopedUserId && stored.sessionId) setSession(stored);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    loadProducts().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [loadProducts]);

  useEffect(() => {
    loadAgeCheck().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [loadAgeCheck]);

  useEffect(() => {
    loadState().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [loadState]);

  useEffect(() => {
    if (!readMiniAppMode() || session?.sessionId) return;
    connectMiniAppSession()
      .then(() => loadState())
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [connectMiniAppSession, loadState, session?.sessionId]);

  const requireLogin = useCallback(() => {
    if (session?.sessionId) return true;
    setIsLoginOpen(true);
    return false;
  }, [session?.sessionId]);

  const startLogin = async () => {
    setIsLoginOpen(true);
    setLoginQr(null);
    setLoginStatus("Creating one-time QR...");
    const response = await fetch("/api/unet/login/challenge", { method: "POST" });
    const created = await response.json().catch(() => ({})) as {
      success?: boolean;
      message?: string;
      qrPayload?: string;
      challenge?: { requestRef?: string };
    };
    if (!response.ok || !created.success || !created.qrPayload || !created.challenge?.requestRef) {
      throw new Error(created.message || "The supermarket could not create a login QR.");
    }
    setLoginQr(await QRCode.toDataURL(created.qrPayload, { width: 320, margin: 2 }));
    setLoginStatus("Scan with U-net and approve on your phone.");
    const deadline = Date.now() + 120000;
    let result: { state?: string; session?: { scopedUserId?: string; sessionId?: string }; message?: string } = { state: "pending" };
    while (result.state === "pending" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const poll = await fetch(`/api/unet/login/status?requestRef=${encodeURIComponent(created.challenge.requestRef)}`, { cache: "no-store" });
      result = await poll.json().catch(() => ({ state: "failed", message: "Could not read login status." }));
      if (!poll.ok) throw new Error(result.message || "Could not read login status.");
    }
    if (result.state === "approved") {
      const approved = result.session;
      if (!approved?.scopedUserId || !approved.sessionId) throw new Error("Provider approved login without a scoped session.");
      const exchangeResponse = await fetch("/api/unet/login/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: approved.sessionId }),
      });
      const exchanged = await exchangeResponse.json().catch(() => ({})) as { success?: boolean; message?: string };
      if (!exchangeResponse.ok || !exchanged.success) throw new Error(exchanged.message || "Provider session exchange failed.");
      saveSession({ scopedUserId: approved.scopedUserId, sessionId: approved.sessionId });
      setLoginStatus("Signed in.");
      setIsLoginOpen(false);
      await loadState();
    } else {
      setLoginStatus(result.state === "denied" ? "Login denied." : "QR expired.");
    }
  };

  const setFavorite = async (productId: string, favorite: boolean) => {
    if (!requireLogin()) return;
    saveAccountState({ ...state, favorites: favorite ? Array.from(new Set([...state.favorites, productId])) : state.favorites.filter((id) => id !== productId) });
  };

  const setBasket = async (productId: string, quantity: number) => {
    if (!requireLogin()) return;
    const basket = state.basket.filter((item) => item.productId !== productId);
    if (quantity > 0) basket.push({ productId, quantity: Math.max(0, Math.floor(quantity)) });
    saveAccountState({ ...state, basket });
  };

  const clearBasket = async () => {
    if (!requireLogin()) return;
    saveAccountState({ ...state, basket: [] });
  };

  const checkout = async () => {
    if (!requireLogin() || isBusy) return;
    setIsBusy(true);
    setVerifyQr(null);
    setVerifyStatus(null);
    setVerifyTone("neutral");
    try {
      const restrictedResourceIds = state.basket
        .map((item) => products.find((product) => product.productId === item.productId && product.requiresChecks?.length)?.productId)
        .filter((item): item is string => Boolean(item));

      if (restrictedResourceIds.length && !ageCheck?.requestType) {
        throw new Error("No active over-18 attestation check is available.");
      }
      const ageCheckRequestType = ageCheck?.requestType;
      const completeCheckout = () => saveAccountState({ ...state, basket: [] });
      const removeRestrictedItems = () => saveAccountState({
        ...state,
        basket: state.basket.filter((item) => !restrictedResourceIds.includes(item.productId)),
      });

      if (miniAppMode && hasHostBridge()) {
        if (!restrictedResourceIds.length) {
          completeCheckout();
          setStatus("Checkout complete. No restricted items required U-net verification.");
          return;
        }
        setStatus("Confirm the over-18 checkout check in the U-net panel.");
        const result = await callHost<{ status?: string; aggregateOutcome?: string; result?: { status?: string; aggregateOutcome?: string; reasonCode?: string } }>(
          "host.requestVerification",
          {
            serviceId: SERVICE_ID,
            requestType: ageCheckRequestType,
            requestedChecks: [ageCheckRequestType],
          },
        );
        const outcome = result.status ?? result.aggregateOutcome ?? result.result?.status ?? result.result?.aggregateOutcome;
        if (outcome === "verified" || outcome === "passed" || outcome === "completed") {
          completeCheckout();
          setStatus("Over-18 check passed. Restricted checkout was approved.");
        } else {
          removeRestrictedItems();
          setStatus(
            `Over-18 check failed or was denied. Restricted items were removed: ${
              result.result?.reasonCode || outcome || "verification_failed"
            }`,
          );
        }
        return;
      }

      const started = await createCheckoutVerification(
        {
          requiredChecks: restrictedResourceIds.length ? [ageCheckRequestType as never] : [],
          restrictedResourceIds,
          ttlSeconds: 300,
        },
      );

      if (!started.requiresVerification) {
        completeCheckout();
        setStatus("Checkout complete. No restricted items required U-net verification.");
        return;
      }

      if (!started.verification?.qrDataUrl || !started.checkout?.checkoutId) {
        throw new Error("U-net did not return a checkout verification QR.");
      }
      setVerifyQr(started.verification.qrDataUrl);
      setVerifyTone("warning");
      setVerifyStatus("Waiting for over-18 proof. Scan with U-net and approve on your phone.");
      const result = await pollCheckoutVerification(started.checkout.checkoutId);
      if (result.checkout?.status === "completed") {
        completeCheckout();
        setVerifyQr(null);
        setVerifyTone("success");
        setVerifyStatus("Over-18 check passed. Checkout complete.");
        setStatus("Over-18 check passed. Restricted checkout was approved.");
      } else {
        removeRestrictedItems();
        setVerifyQr(null);
        setVerifyTone("error");
        setVerifyStatus(
          `Over-18 check failed or was denied. Restricted items were removed: ${
            result.checkout?.failureReason || result.checkout?.status
          }`,
        );
      }
    } catch (error) {
      setVerifyQr(null);
      setVerifyTone("error");
      setVerifyStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const logout = () => {
    saveSession(null);
    setState(emptyState);
    setStatus("Sign in to favorite items and use your basket.");
  };

  return (
    <>
      <header className="top-shell">
        <div className="topbar">
          <div className="brand">
            <div className="brandmark">🛒</div>
            <div>
              <h1>Demo Supermarket</h1>
              <div className="tagline">Scoped login, no email, no password</div>
            </div>
          </div>
          <div className="search">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" />
          </div>
          <button
            className="primary"
            onClick={() => (session?.scopedUserId ? undefined : startLogin().catch((error) => setLoginStatus(error.message)))}
          >
            {session?.scopedUserId ? "Signed in" : "Sign in with U-net"}
          </button>
        </div>
      </header>

      <main>
        <section className="statusbar">
          <div>
            <strong>{session?.scopedUserId ? "Signed in with U-net" : "Browse as guest"}</strong>
            <div className="muted">{status}</div>
          </div>
          {session?.scopedUserId ? (
            <button className="secondary" onClick={logout}>
              Log out
            </button>
          ) : null}
        </section>

        <section>
          <div className="categories">
            {categories.map((item) => (
              <button key={item} className={`category ${category === item ? "active" : ""}`} onClick={() => setCategory(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="grid">
            {filteredProducts.map((product) => {
              const quantity = basketQuantity(product.productId);
              const favorite = state.favorites.includes(product.productId);
              return (
                <article className="product" key={product.productId}>
                  <div className="product-art">{product.imageEmoji}</div>
                  <div className="product-row">
                    <span className="muted">
                      {product.category}
                      {product.requiresChecks?.length ? <span className="restricted">Over 18</span> : null}
                    </span>
                    <button className={`favorite ${favorite ? "on" : ""}`} onClick={() => setFavorite(product.productId, !favorite)}>
                      {favorite ? "♥" : "♡"}
                    </button>
                  </div>
                  <h2>{product.name}</h2>
                  <p>{product.description}</p>
                  <div className="product-row">
                    <div>
                      <div className="price">{money(product.priceCents)}</div>
                      <div className="unit">{product.unit}</div>
                    </div>
                    <div className="qty">
                      <button className="secondary" onClick={() => setBasket(product.productId, quantity - 1)}>
                        −
                      </button>
                      <strong>{quantity}</strong>
                      <button className="primary" onClick={() => setBasket(product.productId, quantity + 1)}>
                        +
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside>
          <section className="panel">
            <h2>Account</h2>
            <div className="muted">{session?.scopedUserId ? "Scoped supermarket account" : "Not signed in."}</div>
            {session?.scopedUserId ? <div className="account-code">{session.scopedUserId}</div> : null}
          </section>

          <section className="panel">
            <h2>Basket</h2>
            {basketLines.length ? (
              basketLines.map((item) => (
                <div className="line" key={item.productId}>
                  <span>
                    {item.product.name}
                    <br />
                    <span className="muted">
                      {item.quantity} × {money(item.product.priceCents)}
                    </span>
                  </span>
                  <strong>{money(item.quantity * item.product.priceCents)}</strong>
                </div>
              ))
            ) : (
              <div className="empty">Your basket is empty.</div>
            )}
            <div className="line">
              <strong>Total</strong>
              <span className="total">{money(totalCents)}</span>
            </div>
            <button className="primary wide" onClick={checkout} disabled={isBusy}>
              {isBusy ? "Checking..." : "Checkout"}
            </button>
            <button className="ghost wide" onClick={() => clearBasket().catch((error) => setStatus(error.message))}>
              Clear basket
            </button>
          </section>

          <section className="panel">
            <h2>Favorites</h2>
            {favoriteProducts.length ? (
              favoriteProducts.map((product) => (
                <div className="line" key={product.productId}>
                  <span>
                    {product.imageEmoji} {product.name}
                  </span>
                  <button className="secondary" onClick={() => setBasket(product.productId, basketQuantity(product.productId) + 1)}>
                    Add
                  </button>
                </div>
              ))
            ) : (
              <div className="empty">No favorites yet.</div>
            )}
          </section>
        </aside>
      </main>

      {isLoginOpen ? (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="product-row">
              <strong>Sign in with U-net</strong>
              <button className="secondary" onClick={() => setIsLoginOpen(false)}>
                Close
              </button>
            </div>
            <div className="qr">{loginQr ? <img alt="U-net login QR" src={loginQr} /> : <span className="muted">Creating QR...</span>}</div>
            <div className="muted">{loginStatus}</div>
          </section>
        </div>
      ) : null}

      {verifyStatus ? (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="product-row">
              <strong>Verify age for checkout</strong>
              <button className="secondary" onClick={() => setVerifyStatus(null)}>
                Close
              </button>
            </div>
            <div className="qr">{verifyQr ? <img alt="U-net verification QR" src={verifyQr} /> : <div className="verify-result-icon">{verifyTone === "success" ? "✓" : "!"}</div>}</div>
            <div className={`verify-status ${verifyTone}`}>{verifyStatus}</div>
          </section>
        </div>
      ) : null}
    </>
  );
}
