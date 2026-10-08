import { Currency, Prisma } from "@prisma/client";
import { body, currency, currencyScale, money, MoneyDecimal, pagination } from "../dto/rights.dto";
import { RightsRepository } from "../repositories/rights.repository";
import { AppError } from "../utils/errors";

export interface RevenueShare { userId: number; percentage: string; }
export function allocateRevenue(value: Prisma.Decimal | string, unit: Currency, contributors: RevenueShare[]) {
  const amount = money(value.toString(), unit), scale = currencyScale[unit]!;
  if (!contributors.length) throw new AppError(409, "No contributors");
  const shares = new Map<number, Prisma.Decimal>();
  for (const item of contributors) {
    const percentage = new Prisma.Decimal(item.percentage);
    if (!Number.isSafeInteger(item.userId) || item.userId <= 0 || percentage.lte(0) || percentage.gt(100) || percentage.decimalPlaces() > 2) throw new AppError(409, "Invalid revenue contribution");
    shares.set(item.userId, (shares.get(item.userId) ?? new Prisma.Decimal(0)).plus(percentage));
  }
  if (![...shares.values()].reduce((sum, share) => sum.plus(share), new Prisma.Decimal(0)).eq(100)) throw new AppError(409, "Revenue contributions must total 100%");
  // Work in integer minor units and use largest remainder, with userId as the stable tie breaker.
  const factor = 10n ** BigInt(scale), minor = BigInt(amount.mul(factor.toString()).toFixed(0));
  const rows = [...shares].map(([userId, share]) => {
    const numerator = minor * BigInt(share.mul(100).toFixed(0));
    return { userId, percentage: share, units: numerator / 10000n, remainder: numerator % 10000n };
  });
  let residue = minor - rows.reduce((sum, row) => sum + row.units, 0n);
  const priority = [...rows].sort((a, b) => a.remainder === b.remainder ? a.userId - b.userId : a.remainder > b.remainder ? -1 : 1);
  for (const row of priority) if (residue > 0n) { row.units++; residue--; }
  return rows.sort((a, b) => a.userId - b.userId).map(row => ({ userId: row.userId, percentage: row.percentage, amount: new MoneyDecimal(row.units.toString()).div(factor.toString()), currency: unit }));
}
export class RevenueService {
  constructor(private readonly repo: RightsRepository) {}
  async summary(userId: number) {
    const allocations = await this.repo.db.revenueAllocation.findMany({ where: { userId }, include: { transaction: { select: { source: true, status: true, confirmedAt: true } } } });
    const currencies = new Map<Currency, { currency: Currency; estimated: Prisma.Decimal; confirmed: Prisma.Decimal; available: Prisma.Decimal }>();
    for (const allocation of allocations) {
      if (allocation.transaction.status !== "COMPLETED") continue;
      const row = currencies.get(allocation.currency) ?? { currency: allocation.currency, estimated: new MoneyDecimal(0), confirmed: new MoneyDecimal(0), available: new MoneyDecimal(0) };
      if (allocation.confirmedAt && allocation.transaction.confirmedAt && allocation.transaction.source === "REAL") row.confirmed = row.confirmed.plus(allocation.amount);
      else row.estimated = row.estimated.plus(allocation.amount);
      // Actual withdrawable balance must come from a RevenueSplitter adapter, currently unconfigured.
      currencies.set(allocation.currency, row);
    }
    return { withdrawalSupported: false, allocationCount: allocations.length, balances: [...currencies.values()], note: "available is zero until an on-chain RevenueSplitter balance is verified" };
  }
  async history(userId: number, value: unknown) {
    const { page, limit, skip } = pagination(value);
    const where = { userId };
    const [items, total] = await this.repo.db.$transaction([
      this.repo.db.revenueAllocation.findMany({ where, include: { transaction: { select: { id: true, source: true, status: true, confirmedAt: true } } }, orderBy: { id: "desc" }, skip, take: limit }), this.repo.db.revenueAllocation.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  async withdraw(userId: number, value: unknown) {
    const input = body(value, ["amount", "currency", "idempotencyKey"]), unit = currency(input.currency), amount = money(input.amount, unit);
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(input.idempotencyKey))) throw new AppError(400, "Invalid idempotencyKey");
    // This is a preparation record, not a reservation of withdrawable funds or a payout.
    const reference = input.idempotencyKey ? `withdraw:${userId}:${input.idempotencyKey}` : undefined;
    return this.repo.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
      if (reference) {
        const existing = await tx.revenueWithdrawal.findUnique({ where: { paymentReference: reference } });
        if (existing) {
          if (existing.userId !== userId || !existing.amount.eq(amount) || existing.currency !== unit) throw new AppError(409, "Idempotency key reused with different values");
          return { ...existing, supported: false };
        }
      }
      const request = await tx.revenueWithdrawal.create({ data: { userId, amount, currency: unit, status: "PREPARING", paymentReference: reference } });
      return { ...request, supported: false };
    });
  }
}
