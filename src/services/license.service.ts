import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { body, currency, flag, licenseType, money, pagination, string } from "../dto/rights.dto";
import { trackId } from "../dto/track.dto";
import { PaymentExpectation, PaymentProvider, matchingPayment } from "../providers/payment.provider";
import { RightsRepository } from "../repositories/rights.repository";
import { creatorShares } from "./contribution.service";
import { eligibleTrack } from "./marketplace.service";
import { allocateRevenue, RevenueShare } from "./revenue.service";
import { AppError } from "../utils/errors";

export class LicenseService {
  constructor(private readonly repo: RightsRepository, private readonly payment: PaymentProvider) {}
  async purchase(userId: number, value: unknown, headerKey?: unknown) {
    const input = body(value, ["trackId", "licenseType", "amount", "currency", "preparation", "idempotencyKey"]);
    const id = trackId(input.trackId), type = licenseType(input.licenseType), preparation = flag(input.preparation);
    const key = input.idempotencyKey ?? headerKey ?? randomUUID();
    if (typeof key !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(key)) throw new AppError(400, "Invalid idempotency key");
    return this.repo.locked(id, async (tx, track) => {
      if (track.ownerId === userId) throw new AppError(403, "A seller cannot purchase their own license");
      eligibleTrack(track, !preparation);
      const listing = await tx.marketplaceListing.findFirst({ where: { trackId: id, status: preparation ? { in: ["PREPARING", "ACTIVE"] } : "ACTIVE" }, orderBy: { id: "desc" } });
      if (!listing || listing.licenseType !== type) throw new AppError(409, "No matching active/preparation listing");
      if (input.currency !== undefined && currency(input.currency) !== listing.currency) throw new AppError(409, "Purchase currency does not match the listing");
      if (input.amount !== undefined && !money(input.amount, listing.currency).eq(listing.price)) throw new AppError(409, "Purchase amount does not match the listing");
      const previous = await tx.purchaseRequest.findUnique({ where: { buyerId_idempotencyKey: { buyerId: userId, idempotencyKey: key } } });
      if (previous) {
        if (previous.trackId !== id || previous.licenseType !== type || previous.preparation !== preparation || !previous.price.eq(listing.price) || previous.currency !== listing.currency) throw new AppError(409, "Idempotency key reused with different values");
        return previous;
      }
      if (await tx.purchaseRequest.findFirst({ where: { activeBuyerTrackType: `${userId}:${id}:${type}:${preparation ? "preparation" : "live"}` } }) || await tx.license.findFirst({ where: { trackId: id, buyerId: userId, type, source: "REAL", licenseStatus: "COMPLETED" } })) throw new AppError(409, "License purchase already exists");
      const request = await tx.purchaseRequest.create({ data: { trackId: id, buyerId: userId, listingId: listing.id, licenseType: type, price: listing.price, currency: listing.currency, preparation, buyerWalletAddress: (await tx.user.findUniqueOrThrow({where:{id:userId}})).walletAddress, source: preparation ? this.payment.source === "MOCK" ? "MOCK" : "UNCONFIGURED" : "UNCONFIGURED", idempotencyKey: key, activeBuyerTrackType: `${userId}:${id}:${type}:${preparation ? "preparation" : "live"}`, contributorSnapshot: creatorShares(track) as Prisma.InputJsonValue } });
      await tx.transaction.create({ data: { trackId: id, userId, purchaseRequestId: request.id, amount: listing.price, currency: listing.currency, status: "PENDING", source: request.source } });
      return request;
    });
  }
  async request(id: number, userId: number) {
    const request = await this.repo.db.purchaseRequest.findUnique({ where: { id }, include: { license: true, transaction: true } });
    if (!request) throw new AppError(404, "Purchase request not found");
    if (request.buyerId !== userId) throw new AppError(403, "Purchase request belongs to another user");
    return { ...request, ownershipConfirmed: request.status === "COMPLETED" && request.source === "REAL", simulated: request.status === "SIMULATED" };
  }
  async list(userId: number, value: unknown) {
    const { page, limit, skip } = pagination(value), where = { buyerId: userId };
    const [items, total] = await this.repo.db.$transaction([
      this.repo.db.license.findMany({ where, orderBy: { id: "desc" }, skip, take: limit }), this.repo.db.license.count({ where }),
    ]);
    return { items: items.map(item => ({ ...item, ownershipConfirmed: item.source === "REAL" && item.licenseStatus === "COMPLETED" })), total, page, limit };
  }
  async detail(id: number, userId: number) {
    const license = await this.repo.db.license.findUnique({ where: { id } });
    if (!license) throw new AppError(404, "License not found");
    if (license.buyerId !== userId) throw new AppError(403, "License belongs to another user");
    return { ...license, ownershipConfirmed: license.source === "REAL" && license.licenseStatus === "COMPLETED" };
  }
  async cancel(id: number, userId: number) {
    return this.repo.purchase(id, userId, async (tx, request) => {
      if (request.status === "CANCELLED") return request;
      if (request.status !== "PENDING_PAYMENT") throw new AppError(409, "Only unpaid purchase requests may be cancelled");
      if (!request.preparation && request.currency === "ETH" && request.buyerWalletAddress) throw new AppError(409, "A wallet purchase cannot be cancelled in the DB; its transaction may still execute on chain");
      if (request.transaction) await tx.transaction.update({ where: { id: request.transaction.id }, data: { status: "FAILED", failureReason: "Purchase cancelled" } });
      return tx.purchaseRequest.update({ where: { id }, data: { status: "CANCELLED", activeBuyerTrackType: null } });
    });
  }
  // Called by a trusted worker or buyer reconcile endpoint; proof always comes from the provider.
  async reconcile(id: number, userId: number) {
    const request = await this.request(id, userId);
    if (["COMPLETED", "SIMULATED"].includes(request.status)) return request;
    if (["FAILED", "CANCELLED"].includes(request.status)) throw new AppError(409, "Purchase request is terminal");
    const expected: PaymentExpectation = { requestId: id, buyerId: userId, trackId: request.trackId, licenseType: request.licenseType, amount: request.price.toString(), currency: request.currency, preparation: request.preparation };
    const receipt = await this.payment.verifyPayment(expected);
    if (receipt.source !== this.payment.source) throw new AppError(502, "Provider proof source mismatch");
    matchingPayment(expected, receipt);
    return this.repo.purchase(id, userId, async (tx, current, track) => {
      if (["COMPLETED", "SIMULATED"].includes(current.status)) return current;
      if (["FAILED", "CANCELLED"].includes(current.status)) throw new AppError(409, "Purchase request is terminal");
      if (current.preparation !== request.preparation || !current.price.eq(request.price) || current.currency !== request.currency) throw new AppError(409, "Purchase inputs changed");
      if (current.transaction?.paymentReference && (current.transaction.source !== receipt.source || current.transaction.paymentReference !== receipt.paymentReference || (receipt.source === "REAL" && current.transaction.txHash !== receipt.txHash))) throw new AppError(502, "Payment proof changed during minting");
      if (receipt.failed) {
        if (current.status !== "PENDING_PAYMENT") throw new AppError(409, "Confirmed payments require a refund adapter");
        if (current.transaction) await tx.transaction.update({ where: { id: current.transaction.id }, data: { status: "FAILED", failureReason: "Payment provider rejected the purchase" } });
        return tx.purchaseRequest.update({ where: { id }, data: { status: "FAILED", activeBuyerTrackType: null, failureReason: "Payment provider rejected the purchase" } });
      }
      if (!receipt.paymentConfirmed) return current;
      const settledOnChain = receipt.source === "REAL" && receipt.chainId === "31337" && receipt.blockNumber !== undefined && receipt.allocations !== undefined;
      if(!settledOnChain) eligibleTrack(track, receipt.source === "REAL");
      const listing = await tx.marketplaceListing.findUniqueOrThrow({ where: { id: current.listingId } });
      if (receipt.source === "REAL" && !settledOnChain && listing.status !== "ACTIVE" || receipt.source === "MOCK" && listing.status === "INACTIVE") throw new AppError(409, "Listing is no longer available");
      const realComplete = receipt.source === "REAL" && receipt.mintConfirmed;
      const simulated = receipt.source === "MOCK" && receipt.mintConfirmed;
      const confirmedAt = realComplete ? new Date() : null;
      const license = current.license ?? await tx.license.create({ data: { trackId: current.trackId, buyerId: userId, type: current.licenseType, price: current.price, currency: current.currency, source: receipt.source, licenseStatus: "PENDING_MINT" } });
      await tx.license.update({ where: { id: license.id }, data: { licenseStatus: realComplete ? "COMPLETED" : "PENDING_MINT", source: receipt.source, issuedAt: confirmedAt, purchaseTxHash: receipt.source === "REAL" ? receipt.txHash : null, tokenId: realComplete ? receipt.tokenId : null } });
      const transaction = await tx.transaction.upsert({ where: { purchaseRequestId: id }, create: {
        trackId: current.trackId, userId, licenseId: license.id, purchaseRequestId: id, amount: current.price, currency: current.currency, source: receipt.source, paymentReference: receipt.paymentReference,
        chainId: receipt.chainId, blockNumber: receipt.blockNumber, status: realComplete || simulated ? "COMPLETED" : "PENDING", confirmedAt, txHash: receipt.source === "REAL" ? receipt.txHash : null,
      }, update: { chainId: receipt.chainId, blockNumber: receipt.blockNumber, licenseId: license.id, source: receipt.source, status: realComplete || simulated ? "COMPLETED" : "PENDING", confirmedAt, paymentReference: receipt.paymentReference, txHash: receipt.source === "REAL" ? receipt.txHash : null } });
      if (realComplete || simulated) {
        const rows = receipt.source === "REAL" && receipt.allocations ? receipt.allocations : allocateRevenue(current.price, current.currency, current.contributorSnapshot as unknown as RevenueShare[]);
        for (const row of rows) await tx.revenueAllocation.upsert({ where: { transactionId_userId: { transactionId: transaction.id, userId: row.userId } }, create: { ...row, transactionId: transaction.id, confirmedAt }, update: {} });
      }
      return tx.purchaseRequest.update({ where: { id }, data: { licenseId: license.id, status: realComplete ? "COMPLETED" : simulated ? "SIMULATED" : "PENDING_MINT", source: receipt.source, confirmedAt, ...(simulated ? { activeBuyerTrackType: null } : {}) } });
    });
  }
}
