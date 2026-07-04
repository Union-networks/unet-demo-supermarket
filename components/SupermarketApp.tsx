"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCheckoutVerification, pollCheckoutVerification } from "@union-networks/verification";
import { createLoginSession, pollLoginSession } from "@union-networks/web-login";
import { SERVICE_ID, TRUST_PLANE_ORIGIN } from "../lib/config";
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

const sessionKey = "unet.demoSupermarket.session.v2";
const emptyState: AccountState = { favorites: [], basket: [] };
const sdkOptions = { issuerBaseUrl: TRUST_PLANE_ORIGIN, verifierBaseUrl: TRUST_PLANE_ORIGIN };

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`;

function readMiniAppMode() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("miniapp") === "1";
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
  const hostSeq = useRef(0);
  const pendingHost = useRef(new Map<string, PendingHostRequest>());

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    if (session?.assertionJws) headers.authorization = `Bearer ${session.assertionJws}`;
    return headers;
  }, [session?.assertionJws]);

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

  const api = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers);
      headers.set("content-type", "application/json");
      Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value));
      const response = await fetch(`${TRUST_PLANE_ORIGIN}${path}`, {
        ...options,
        headers,
      });
      const body = (await response.json().catch(() => ({}))) as T & { success?: boolean; message?: string };
      if (response.status === 401) {
        saveSession(null);
        setState(emptyState);
        throw new Error("Please sign in again.");
      }
      if (!response.ok || body.success === false) throw new Error(body.message || "Request failed.");
      return body;
    },
    [authHeaders, saveSession],
  );

  const loadProducts = useCallback(async () => {
    const body = await api<{ products: ProductRecord[] }>("/v1/demo/supermarket/products");
    setProducts(body.products || []);
  }, [api]);

  const loadState = useCallback(async () => {
    if (!session?.assertionJws) return;
    const body = await api<{ state: AccountState }>("/v1/demo/supermarket/state");
    setState(body.state || emptyState);
  }, [api, session?.assertionJws]);

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
        const timeout = setTimeout(() => {
          pendingHost.current.delete(id);
          reject(new Error("U-net host did not respond."));
        }, 15000);
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
    const context = await callHost<{ scopedUserId?: string }>("host.getContext");
    const proof = await callHost<Record<string, unknown>>("host.createMiniProgramSession");
    const created = await api<{ scopedUserId?: string; assertionJws: string; sessionId?: string }>(
      "/v1/demo/supermarket/miniapp-session",
      { method: "POST", body: JSON.stringify(proof), headers: {} },
    );
    saveSession({
      scopedUserId: created.scopedUserId || context.scopedUserId || "",
      assertionJws: created.assertionJws,
      sessionId: created.sessionId,
    });
    setStatus("Connected through the U-net app. This shop only knows your supermarket-scoped ID.");
  }, [api, callHost, saveSession]);

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
      if (stored?.assertionJws) setSession(stored);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    loadProducts().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [loadProducts]);

  useEffect(() => {
    loadState().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [loadState]);

  useEffect(() => {
    if (!readMiniAppMode() || session?.assertionJws) return;
    connectMiniAppSession()
      .then(() => loadState())
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [connectMiniAppSession, loadState, session?.assertionJws]);

  const requireLogin = useCallback(() => {
    if (session?.assertionJws) return true;
    setIsLoginOpen(true);
    return false;
  }, [session?.assertionJws]);

  const startLogin = async () => {
    setIsLoginOpen(true);
    setLoginQr(null);
    setLoginStatus("Creating one-time QR...");
    const created = await createLoginSession(
      { serviceId: SERVICE_ID, origin: window.location.origin, expiresInSeconds: 120 },
      sdkOptions,
    );
    if (!created.sessionId || !created.qrDataUrl) throw new Error("U-net did not return a login QR.");
    setLoginQr(created.qrDataUrl);
    setLoginStatus("Scan with U-net and approve on your phone.");
    const result = await pollLoginSession(created.sessionId, { ...sdkOptions, intervalMs: 1500, timeoutMs: 120000 });
    if (result.status === "approved") {
      if (!result.scopedUserId || !result.assertionJws) throw new Error("U-net approved login without a scoped session.");
      saveSession({ scopedUserId: result.scopedUserId, assertionJws: result.assertionJws, sessionId: result.sessionId });
      setLoginStatus("Signed in.");
      setIsLoginOpen(false);
      await loadState();
    } else if (result.status === "denied" || result.status === "expired") {
      setLoginStatus(result.status === "denied" ? "Login denied." : "QR expired.");
    }
  };

  const setFavorite = async (productId: string, favorite: boolean) => {
    if (!requireLogin()) return;
    const body = await api<{ state: AccountState }>("/v1/demo/supermarket/favorites", {
      method: "POST",
      body: JSON.stringify({ productId, favorite }),
    });
    setState(body.state);
  };

  const setBasket = async (productId: string, quantity: number) => {
    if (!requireLogin()) return;
    const body = await api<{ state: AccountState }>("/v1/demo/supermarket/basket", {
      method: "POST",
      body: JSON.stringify({ productId, quantity }),
    });
    setState(body.state);
  };

  const clearBasket = async () => {
    if (!requireLogin()) return;
    const body = await api<{ state: AccountState }>("/v1/demo/supermarket/basket/clear", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setState(body.state);
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

      if (miniAppMode && hasHostBridge()) {
        if (!restrictedResourceIds.length) {
          const body = await api<{ checkout?: { state?: AccountState } }>("/v1/demo/supermarket/checkout/start", {
            method: "POST",
            body: JSON.stringify({}),
          });
          if (body.checkout?.state) setState(body.checkout.state);
          setStatus("Checkout complete. No restricted items required U-net verification.");
          return;
        }
        setStatus("Confirm the over-18 checkout check in the U-net panel.");
        const result = await callHost<{ checkout?: { state?: AccountState; status?: string; failureReason?: string } }>(
          "host.requestVerification",
          { serviceId: SERVICE_ID },
        );
        if (result.checkout?.state) setState(result.checkout.state);
        else await loadState();
        if (result.checkout?.status === "completed") {
          setStatus("Over-18 check passed. Restricted checkout was approved.");
        } else {
          setStatus(
            `Over-18 check failed or was denied. Restricted items were removed: ${
              result.checkout?.failureReason || result.checkout?.status || "verification_failed"
            }`,
          );
        }
        return;
      }

      const started = await createCheckoutVerification(
        {
          serviceId: SERVICE_ID,
          assertionJws: session?.assertionJws || "",
          requiredChecks: restrictedResourceIds.length ? ["age_over_18"] : [],
          restrictedResourceIds,
          ttlSeconds: 300,
        },
        sdkOptions,
      );

      if (!started.requiresVerification) {
        await loadState();
        setStatus("Checkout complete. No restricted items required U-net verification.");
        return;
      }

      if (!started.verification?.qrDataUrl || !started.checkout?.checkoutId) {
        throw new Error("U-net did not return a checkout verification QR.");
      }
      setVerifyQr(started.verification.qrDataUrl);
      setVerifyTone("warning");
      setVerifyStatus("Waiting for over-18 proof. Scan with U-net and approve on your phone.");
      const result = await pollCheckoutVerification(
        { checkoutId: started.checkout.checkoutId, serviceId: SERVICE_ID, assertionJws: session?.assertionJws || "" },
        { ...sdkOptions, intervalMs: 1500, timeoutMs: 300000 },
      );
      await loadState();
      if (result.checkout?.status === "completed") {
        setVerifyQr(null);
        setVerifyTone("success");
        setVerifyStatus("Over-18 check passed. Checkout complete.");
        setStatus("Over-18 check passed. Restricted checkout was approved.");
      } else {
        setVerifyQr(null);
        setVerifyTone("error");
        setVerifyStatus(
          `Over-18 check failed or was denied. Restricted items were removed: ${
            result.checkout?.failureReason || result.checkout?.status
          }`,
        );
      }
    } catch (error) {
      await loadState().catch(() => undefined);
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
