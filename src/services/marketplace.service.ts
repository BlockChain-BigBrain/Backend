import { chainClient } from "../blockchain/client";
import { formatEther, parseEther } from "ethers";
import { Prisma } from "@prisma/client";
import { body, currency, licenseType, money, pagination, riskStatus } from "../dto/rights.dto";
import { own, RightsRepository, RightsTrack, rightsTrackInclude } from "../repositories/rights.repository";
import { creatorShares } from "./contribution.service";
import { snapshotMatchesTrack } from "./metadata.service";
import { AppError } from "../utils/errors";
import { trackId } from "../dto/track.dto";

export function eligibleTrack(track: RightsTrack, real: boolean) {
  const verification = track.verifications[0];
  if (!verification || verification.status !== "VERIFIED" || verification.duplicate !== false || verification.riskScore === null || !["PASS", "WARN"].includes(verification.riskStatus ?? "") || riskStatus(verification.riskScore.toNumber()) !== verification.riskStatus || !["AI", "MOCK"].includes(verification.source)) throw new AppError(409, "Track has no eligible verification or is duplicate/HOLD");
  if (!track.contributionsFinalizedAt) throw new AppError(409, "Contributions must be finalized");
  creatorShares(track);
  if (real) {
    const registration = track.registrationRequests[0];
    if (!track.isPublic || verification.source !== "AI" || track.registrationStatus !== "REGISTERED" || !track.registrationTxHash || !registration || registration.status !== "REGISTERED" || registration.source !== "REAL" || !registration.confirmedAt) throw new AppError(409, "Real verified blockchain registration and public visibility are required");
    const snapshot = track.metadataSnapshots[0];
    if (!snapshot || !snapshotMatchesTrack(track) || snapshot.status !== "UPLOADED" || registration.metadataSnapshotId !== snapshot.id || snapshot.metadataCid !== track.metadataCid || (snapshot.document as any)?.verification?.id !== verification.id) throw new AppError(409, "Registered metadata does not match the current verification");
  }
}
export function marketView(listing: { id: number; trackId: number; sellerId: number; price: Prisma.Decimal; currency: string; status: string; licenseType: string; createdAt: Date }, track: RightsTrack) {
  const verification = track.verifications[0];
  return { ...listing, track: { id: track.id, title: track.title, creator: { id: track.owner.id, name: track.owner.name }, audioPath: `/api/tracks/${track.id}/audio`, verification: verification ? { source: verification.source, duplicate: verification.duplicate, riskScore: verification.riskScore, riskStatus: verification.riskStatus, modelVersion: verification.modelVersion } : null }, warning: verification?.riskStatus === "WARN", purchasable: listing.status === "ACTIVE", preparation: listing.status === "PREPARING" };
}
export class MarketplaceService {
  constructor(private readonly repo: RightsRepository) {}
  async chainView(listing: any, track: RightsTrack) {
    const view=marketView(listing,track);
    if(!chainClient.configured) return view;
    await chainClient.ready();
    if(track.registrationStatus!=="REGISTERED" || !track.blockchainTrackId) return {...view,purchasable:false,onChain:null};
    if(track.registrationRequests[0]?.contractAddress?.toLowerCase()!==chainClient.addresses.TrackRegistry.toLowerCase() || track.registrationRequests[0]?.chainId!==chainClient.chainId) throw new AppError(409,"Listing belongs to a different deployment");
    const onTrack=await chainClient.contracts.TrackRegistry.getTrack(track.blockchainTrackId);
    if(onTrack.audioHash!==`0x${track.audioHash}` || onTrack.metadataCID!==track.metadataCid || onTrack.registrant.toLowerCase()!==track.owner.walletAddress?.toLowerCase()) throw new AppError(409,"Registered chain track differs from backend");
    const price:bigint=await chainClient.contracts.LicenseMarketplace.getLicensePrice(track.blockchainTrackId);
    const licensable=await chainClient.contracts.TrackRegistry.isTrackLicensable(track.blockchainTrackId);
    return {...view,purchasable:view.purchasable && licensable && price>0n && listing.currency==="ETH" && listing.licenseType==="COMMERCIAL" && parseEther(listing.price.toFixed(18))===price,onChain:{chainId:chainClient.chainId,blockchainTrackId:track.blockchainTrackId,priceWei:price.toString(),price:formatEther(price),currency:"ETH",licensable}};
  }
  async activeChain(track:RightsTrack, price:Prisma.Decimal, unit:string, type:string) {
    if(!chainClient.configured) return;
    await chainClient.ready();
    if(unit!=="ETH" || type!=="COMMERCIAL" || !track.blockchainTrackId || track.registrationRequests[0]?.contractAddress?.toLowerCase()!==chainClient.addresses.TrackRegistry.toLowerCase()) throw new AppError(409,"Use the local ETH COMMERCIAL registered deployment");
    const confirmedBlock=await chainClient.provider.getBlockNumber()-chainClient.confirmations+1;
    if(confirmedBlock<0 || await chainClient.contracts.LicenseMarketplace.getLicensePrice(track.blockchainTrackId,{blockTag:confirmedBlock})!==parseEther(price.toFixed(18))) throw new AppError(409,"Set price on chain and confirm before activating/changing the listing");
  }
  async create(userId: number, value: unknown) {
    const input = body(value, ["trackId", "price", "currency", "status", "licenseType"]);
    const id = trackId(input.trackId), unit = currency(input.currency), price = money(input.price, unit);
    const status = input.status ?? "PREPARING";
    if (status !== "PREPARING" && status !== "ACTIVE") throw new AppError(400, "Invalid listing status");
    const type = licenseType(input.licenseType ?? "COMMERCIAL");
    return this.repo.locked(id, async (tx, track) => {
      own(track, userId); eligibleTrack(track, status === "ACTIVE");
      if(status === "ACTIVE") await this.activeChain(track,price,unit,type);
      if (await tx.marketplaceListing.findFirst({ where: { trackId: id, status: { in: ["PREPARING", "ACTIVE"] } } })) throw new AppError(409, "Track already has a sale or preparation listing");
      const listing = await tx.marketplaceListing.create({ data: { trackId: id, sellerId: userId, price, currency: unit, status, licenseType: type, activeTrackId: status === "ACTIVE" ? id : null } });
      return this.chainView(listing, track);
    });
  }
  async get(id: number, userId?: number) {
    const listing = await this.repo.db.marketplaceListing.findUnique({ where: { id } });
    if (!listing || (listing.status !== "ACTIVE" && listing.sellerId !== userId)) throw new AppError(404, "Listing not found");
    const track = await this.repo.track(listing.trackId, listing.sellerId);
    if (listing.status === "ACTIVE") eligibleTrack(track, true);
    return this.chainView(listing, track);
  }
  async update(id: number, userId: number, value: unknown) {
    const input = body(value, ["price", "currency", "status", "licenseType"]);
    if (!Object.keys(input).length) throw new AppError(400, "At least one field is required");
    const old = await this.repo.db.marketplaceListing.findUnique({ where: { id } });
    if (!old) throw new AppError(404, "Listing not found");
    return this.repo.locked(old.trackId, async (tx, track) => {
      own(track, userId);
      const listing = await tx.marketplaceListing.findUniqueOrThrow({ where: { id } });
      const unit = input.currency === undefined ? listing.currency : currency(input.currency);
      const price = money(input.price ?? listing.price.toString(), unit);
      const status = input.status ?? listing.status;
      if (!["PREPARING", "ACTIVE", "INACTIVE"].includes(String(status))) throw new AppError(400, "Invalid listing status");
      if (status !== "INACTIVE") {
        eligibleTrack(track, status === "ACTIVE");
        if (await tx.marketplaceListing.findFirst({ where: { trackId: track.id, id: { not: id }, status: { in: ["PREPARING", "ACTIVE"] } } })) throw new AppError(409, "Another listing exists");
      }
      if(status === "ACTIVE") await this.activeChain(track,price,unit,input.licenseType===undefined?listing.licenseType:licenseType(input.licenseType));
      const updated = await tx.marketplaceListing.update({ where: { id }, data: { price, currency: unit, status: status as "PREPARING" | "ACTIVE" | "INACTIVE", activeTrackId: status === "ACTIVE" ? track.id : null, licenseType: input.licenseType === undefined ? listing.licenseType : licenseType(input.licenseType) } });
      return this.chainView(updated, track);
    });
  }
  async list(value: unknown, userId?: number) {
    const { input, page, limit, skip } = pagination(value);
    const scope = input.scope ?? "public";
    if (scope !== "public" && scope !== "mine") throw new AppError(400, "Invalid listing scope");
    if (scope === "mine" && !userId) throw new AppError(401, "Authentication is required");
    const sort = input.sort ?? "createdAt", order = input.order ?? "desc";
    if (typeof sort !== "string" || typeof order !== "string" || !["createdAt", "price"].includes(sort) || !["asc", "desc"].includes(order)) throw new AppError(400, "Invalid listing sort");
    const unit = input.currency === undefined ? undefined : currency(input.currency);
    if ((input.minPrice !== undefined || input.maxPrice !== undefined || sort === "price") && !unit) throw new AppError(400, "currency is required for comparing prices");
    const min = input.minPrice === undefined ? undefined : money(input.minPrice, unit!, true);
    const max = input.maxPrice === undefined ? undefined : money(input.maxPrice, unit!, true);
    if (min && max && min.gt(max)) throw new AppError(400, "minPrice exceeds maxPrice");
    if (input.search !== undefined && (typeof input.search !== "string" || input.search.length > 191)) throw new AppError(400, "Invalid search");
    const clauses: Prisma.Sql[] = [];
    if (scope === "mine") clauses.push(Prisma.sql`l.sellerId = ${userId!}`);
    else clauses.push(Prisma.sql`l.status = 'ACTIVE' AND t.isPublic = true AND t.registrationStatus = 'REGISTERED'
      AND v.status = 'VERIFIED' AND v.source = 'AI' AND v.duplicate = false AND v.riskStatus IN ('PASS','WARN')
      AND EXISTS (SELECT 1 FROM RegistrationRequest r WHERE r.trackId=t.id AND r.status='REGISTERED' AND r.source='REAL' AND r.confirmedAt IS NOT NULL)`);
    if (unit) clauses.push(Prisma.sql`l.currency = ${unit}`);
    if (min) clauses.push(Prisma.sql`l.price >= ${min.toString()}`);
    if (max) clauses.push(Prisma.sql`l.price <= ${max.toString()}`);
    if (input.search) clauses.push(Prisma.sql`LOCATE(${input.search}, t.title) > 0`);
    const join = Prisma.sql`FROM MarketplaceListing l JOIN Track t ON t.id=l.trackId LEFT JOIN Verification v ON v.id=(SELECT x.id FROM Verification x WHERE x.trackId=t.id ORDER BY x.createdAt DESC,x.id DESC LIMIT 1) WHERE ${Prisma.join(clauses, " AND ")}`;
    const result = await this.repo.db.$transaction(async tx => {
      const count = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total ${join}`);
      const ids = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`SELECT l.id ${join} ORDER BY ${Prisma.raw(sort === "price" ? "l.price" : "l.createdAt")} ${Prisma.raw(order === "asc" ? "ASC" : "DESC")}, l.id ${Prisma.raw(order === "asc" ? "ASC" : "DESC")} LIMIT ${limit} OFFSET ${skip}`);
      const items = [];
      for (const { id } of ids) {
        const listing = await tx.marketplaceListing.findUniqueOrThrow({ where: { id } });
        const track = await tx.track.findUniqueOrThrow({ where: { id: listing.trackId }, include: rightsTrackInclude });
        if (scope === "public") { try { eligibleTrack(track, true); } catch { continue; } }
        items.push(await this.chainView(listing, track));
      }
      return { items, total: Number(count[0].total) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { ...result, page, limit };
  }
}
