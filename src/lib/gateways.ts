// Multi-gateway payment simulation.
// Stripe: test-card semantics (numbers ending in 0002 decline, 9995 insufficient funds)
// PayPal: simulated wallet login + approval
// Crypto: on-chain transfer simulation with confirmation blocks

export type Gateway = "STRIPE" | "PAYPAL" | "CRYPTO";

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
}

export interface ChargeResult {
  ok: boolean;
  error?: string;
  txnId: string;
  gateway: Gateway;
}

function txnId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-6)}`;
}

export function detectCardBrand(number: string): string {
  const n = number.replace(/\s/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^5[1-5]/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^6/.test(n)) return "Discover";
  return "Card";
}

export async function chargeStripeCard(card: CardInput, amountCents: number): Promise<ChargeResult> {
  const n = (card.number || "").replace(/\s/g, "");
  const id = txnId("pi");
  if (!/^\d{13,19}$/.test(n)) {
    return { ok: false, error: "Invalid card number.", txnId: id, gateway: "STRIPE" };
  }
  if (n.endsWith("0002")) {
    return { ok: false, error: "Your card was declined (test decline card).", txnId: id, gateway: "STRIPE" };
  }
  if (n.endsWith("9995")) {
    return { ok: false, error: "Insufficient funds.", txnId: id, gateway: "STRIPE" };
  }
  if (amountCents <= 0) {
    return { ok: true, txnId: id, gateway: "STRIPE" };
  }
  return { ok: true, txnId: id, gateway: "STRIPE" };
}

export async function chargePaypal(email: string, amountCents: number): Promise<ChargeResult> {
  const id = txnId("PAYID");
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Invalid PayPal account.", txnId: id, gateway: "PAYPAL" };
  }
  if (email.toLowerCase().includes("fail")) {
    return { ok: false, error: "PayPal rejected the payment (insufficient balance).", txnId: id, gateway: "PAYPAL" };
  }
  return { ok: true, txnId: id, gateway: "PAYPAL" };
}

export interface CryptoQuote {
  walletAddress: string;
  amountCrypto: string;
  asset: "USDC" | "ETH";
  network: string;
  memo: string;
}

export function quoteCrypto(amountCents: number): CryptoQuote {
  const usd = amountCents / 100;
  const eth = (usd / 3247.82).toFixed(6);
  return {
    walletAddress: "0x7aF3b21c9E4d5A60B8c7F1024e9dD3a5B6c8901F",
    amountCrypto: eth,
    asset: "ETH",
    network: "Ethereum Mainnet",
    memo: `whoply-${txnId("tx").slice(2, 10)}`,
  };
}

export async function chargeCryptoWallet(walletAddress: string | undefined, _amountCents: number): Promise<ChargeResult> {
  const id = txnId("0x");
  if (!walletAddress || !/^0x[a-fA-F0-9]{6,}$/.test(walletAddress)) {
    return { ok: false, error: "Invalid wallet address.", txnId: id, gateway: "CRYPTO" };
  }
  // Crypto is always "broadcast" successfully; confirmation happens async.
  return { ok: true, txnId: id, gateway: "CRYPTO" };
}

// Charges a stored payment method (used by the recurring billing engine).
export async function chargeStoredMethod(
  gateway: string,
  pm: { brand?: string | null; last4?: string | null; email?: string | null; walletAddress?: string | null },
  amountCents: number
): Promise<ChargeResult> {
  if (gateway === "STRIPE") {
    // Cards ending 0002 always decline -> powers dunning demos
    if (pm.last4 === "0002") {
      return { ok: false, error: "Card declined by issuer.", txnId: txnId("pi"), gateway: "STRIPE" };
    }
    return { ok: true, txnId: txnId("pi"), gateway: "STRIPE" };
  }
  if (gateway === "PAYPAL") {
    if (pm.email?.toLowerCase().includes("fail")) {
      return { ok: false, error: "PayPal balance insufficient.", txnId: txnId("PAYID"), gateway: "PAYPAL" };
    }
    return { ok: true, txnId: txnId("PAYID"), gateway: "PAYPAL" };
  }
  // Crypto recurring pull from linked wallet (auto-transfer agreement)
  if (pm.walletAddress?.toLowerCase().endsWith("dead")) {
    return { ok: false, error: "On-chain transfer failed (no balance).", txnId: txnId("0x"), gateway: "CRYPTO" };
  }
  return { ok: true, txnId: txnId("0x"), gateway: "CRYPTO" };
}
