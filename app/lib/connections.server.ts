/**
 * Store pairing for cross-store copy.
 *
 * Two stores are only ever eligible as copy targets for each other after a
 * merchant deliberately links them: shopA generates a short-lived, single-use
 * code; shopB redeems it. This prevents the cross-tenant hole where any store
 * with the app installed could be written to by any other.
 */

import { randomBytes } from "node:crypto";
import prisma from "../db.server";

const CODE_TTL_MINUTES = 15;

/** Human-friendly code, e.g. "METK-8F3A-9QX2" — unambiguous characters only. */
function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const bytes = randomBytes(8);
  let body = "";
  for (let i = 0; i < 8; i++) body += alphabet[bytes[i] % alphabet.length];
  return `MV-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

/**
 * Create a pending connection code for `shop`. Any earlier pending codes from
 * this shop are cleared so only the latest is valid.
 */
export async function generateConnectionCode(
  shop: string,
): Promise<{ code: string; expiresAt: Date }> {
  await prisma.storeConnection.deleteMany({ where: { shopA: shop, status: "pending" } });

  const code = makeCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  await prisma.storeConnection.create({
    data: { shopA: shop, code, status: "pending", expiresAt },
  });
  return { code, expiresAt };
}

/** The pending outgoing code for `shop`, if one is still valid. */
export async function getPendingCode(
  shop: string,
): Promise<{ code: string; expiresAt: Date } | null> {
  const row = await prisma.storeConnection.findFirst({
    where: { shopA: shop, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return row?.code ? { code: row.code, expiresAt: row.expiresAt! } : null;
}

export type RedeemResult =
  | { ok: true; partnerShop: string }
  | { ok: false; error: string };

/** Redeem a code from another store, linking it to `shop`. */
export async function redeemConnectionCode(
  rawCode: string,
  shop: string,
): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a connection code." };

  const pending = await prisma.storeConnection.findUnique({ where: { code } });
  if (!pending || pending.status !== "pending") {
    return { ok: false, error: "That code is invalid or has already been used." };
  }
  if (pending.expiresAt && pending.expiresAt < new Date()) {
    return { ok: false, error: "That code has expired — generate a new one." };
  }
  if (pending.shopA === shop) {
    return { ok: false, error: "You can't connect a store to itself." };
  }
  if (await areConnected(pending.shopA, shop)) {
    // Already linked — consume the dangling code and report success.
    await prisma.storeConnection.delete({ where: { id: pending.id } });
    return { ok: true, partnerShop: pending.shopA };
  }

  await prisma.storeConnection.update({
    where: { id: pending.id },
    data: { shopB: shop, status: "active", code: null, expiresAt: null },
  });
  return { ok: true, partnerShop: pending.shopA };
}

/** True when an active link exists between the two shops (either direction). */
export async function areConnected(shopX: string, shopY: string): Promise<boolean> {
  const row = await prisma.storeConnection.findFirst({
    where: {
      status: "active",
      OR: [
        { shopA: shopX, shopB: shopY },
        { shopA: shopY, shopB: shopX },
      ],
    },
    select: { id: true },
  });
  return !!row;
}

export type ConnectedStore = { connectionId: string; shop: string; installed: boolean };

/**
 * Active partners of `shop`, each flagged with whether it still has an offline
 * session (i.e. the app is still installed and the copy can actually run).
 */
export async function listConnectedStores(shop: string): Promise<ConnectedStore[]> {
  const rows = await prisma.storeConnection.findMany({
    where: { status: "active", OR: [{ shopA: shop }, { shopB: shop }] },
    orderBy: { createdAt: "desc" },
  });

  const partners = rows.map((r) => ({
    connectionId: r.id,
    shop: r.shopA === shop ? (r.shopB as string) : r.shopA,
  }));

  const installedShops = new Set(
    (
      await prisma.session.findMany({
        where: { shop: { in: partners.map((p) => p.shop) }, isOnline: false },
        select: { shop: true },
      })
    ).map((s) => s.shop),
  );

  return partners.map((p) => ({ ...p, installed: installedShops.has(p.shop) }));
}

/** Remove a connection that `shop` is part of (either side may disconnect). */
export async function disconnect(shop: string, connectionId: string): Promise<boolean> {
  const result = await prisma.storeConnection.deleteMany({
    where: { id: connectionId, OR: [{ shopA: shop }, { shopB: shop }] },
  });
  return result.count > 0;
}
