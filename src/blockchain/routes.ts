import { AppError } from "../utils/errors";
import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../middlewares/auth.middleware";
import { asyncHandler } from "../utils/asyncHandler";
import { jsonSafe } from "../controllers/rights.controller";
import { ChainClient } from "./client";
import { ChainCommerce } from "./commerce";
import { ChainSync } from "./sync";
import { trackId } from "../dto/track.dto";
export function chainRoutes(db:PrismaClient,chain:ChainClient) {
 const router=Router(),commerce=new ChainCommerce(db,chain),sync=new ChainSync(db,chain,commerce);
 const wrap=(fn:(req:AuthenticatedRequest)=>Promise<unknown>,status=200)=>asyncHandler(async(req:AuthenticatedRequest,res:Response)=>{res.status(status).json(jsonSafe(await fn(req)));});
 router.get("/blockchain/health",wrap(()=>chain.health()));
 if(chain.configured) {
  router.post("/market/tracks/:id/price-payload",requireAuth,wrap(req=>commerce.price(trackId(req.params.id),req.userId!,req.body??{})));
  router.post("/market/tracks/:id/price/confirm",requireAuth,wrap(async req=>{
   const listing=await db.marketplaceListing.findUniqueOrThrow({where:{id:trackId(req.params.id)}});
   if(listing.sellerId!==req.userId) throw new AppError(403,"Listing belongs to another user");
   const track=await commerce.registered(listing.trackId,req.userId,true);
   const {receipt}=await chain.receipt(req.body?.txHash,"LicenseMarketplace");
   const events=chain.events(receipt,"LicenseMarketplace","LicensePriceUpdated");
   if(events.length!==1 || events[0].args.trackId.toString()!==track.blockchainTrackId) throw new AppError(409,"Price transaction belongs to another track");
   await sync.process(req.body?.txHash);return commerce.marketState(listing.id,req.userId);
  }));
  router.get("/licenses/:id/status",requireAuth,wrap(async req=>{
   const {LicenseService}=await import("../services/license.service.js");
   const {UnconfiguredPaymentProvider}=await import("../providers/payment.provider.js");
   return new LicenseService(commerce.repo,new UnconfiguredPaymentProvider()).detail(trackId(req.params.id),req.userId!);
  }));
  router.post("/licenses/purchase",requireAuth,wrap(req=>commerce.purchase(req.userId!,req.body,req.headers["idempotency-key"]),201));
  router.post("/licenses/purchase/confirm",requireAuth,wrap(async req=>{const result=await commerce.confirm(req.userId!,req.body);await sync.process(req.body.txHash);return result;}));
  router.get("/users/me/revenue",requireAuth,wrap(req=>commerce.revenue(req.userId!)));
  router.post("/revenue/withdraw",requireAuth,wrap(req=>commerce.withdraw(req.userId!,req.body),202));
  router.post("/revenue/withdraw/confirm",requireAuth,wrap(async req=>{const result=await commerce.confirmWithdrawal(req.userId!,req.body);await sync.process(req.body.txHash);return result;}));
 } else {
  for(const endpoint of ["/market/tracks/:id/price-payload","/market/tracks/:id/price/confirm","/licenses/purchase/confirm","/revenue/withdraw/confirm"]) router.post(endpoint,requireAuth,wrap(async()=>{throw new AppError(503,"Local blockchain integration is not configured");}));
 }
 return {router,sync,commerce};
}
