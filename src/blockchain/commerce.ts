import { Prisma, PrismaClient } from "@prisma/client";
import { formatEther, parseEther } from "ethers";
import { ChainClient } from "./client";
import { RightsRepository } from "../repositories/rights.repository";
import { LicenseService } from "../services/license.service";
import { RevenueService } from "../services/revenue.service";
import { PaymentExpectation, PaymentProvider, PaymentReceipt } from "../providers/payment.provider";
import { body, wallet } from "../dto/rights.dto";
import { trackId } from "../dto/track.dto";
import { eligibleTrack } from "../services/marketplace.service";
import { creatorShares } from "../services/contribution.service";
import { AppError } from "../utils/errors";

export function ethWei(value: string): bigint {
  try {const decimal=new Prisma.Decimal(value);if(!decimal.isFinite() || decimal.isNegative() || decimal.decimalPlaces()>18) throw new Error();return parseEther(decimal.toFixed(18));} catch {throw new AppError(400,"Invalid ETH amount");}
}
export class ChainPaymentProvider implements PaymentProvider {
  readonly source = "REAL";
  constructor(private db: PrismaClient, private chain: ChainClient, private txHash: string) {}
  async verifyPayment(expected: PaymentExpectation): Promise<PaymentReceipt> {
    const request = await this.db.purchaseRequest.findUniqueOrThrow({where:{id:expected.requestId},include:{buyer:true,track:true}});
    if (expected.preparation || expected.currency !== "ETH" || expected.licenseType !== "COMMERCIAL") throw new AppError(409,"Local contract supports ETH COMMERCIAL purchases only");
    const address = wallet(request.buyerWalletAddress);
    const {receipt,transaction} = await this.chain.receipt(this.txHash,"LicenseMarketplace",address);
    const call = this.chain.interfaces.LicenseMarketplace.parseTransaction({data:transaction.data,value:transaction.value});
    const id = request.track.blockchainTrackId;
    if (!id || call?.name !== "purchaseLicense" || call.args[0].toString() !== id || transaction.value !== ethWei(expected.amount)) throw new AppError(409,"Purchase calldata/value mismatch");
    const bought = this.chain.events(receipt,"LicenseMarketplace","LicensePurchased"), minted = this.chain.events(receipt,"LicenseNFT","LicenseMinted"), transfers = this.chain.events(receipt,"LicenseNFT","TransferSingle");
    if (bought.length !== 1 || minted.length !== 1 || transfers.length !== 1) throw new AppError(409,"Purchase requires marketplace, mint and ERC1155 transfer proofs");
    const b=bought[0].args,m=minted[0].args,t=transfers[0].args;
    if (b.trackId.toString()!==id || b.tokenId.toString()!==id || b.buyer.toLowerCase()!==address || b.amount!==transaction.value || b.status>1n || m.trackId.toString()!==id || m.tokenId.toString()!==id || m.buyer.toLowerCase()!==address || m.licenseType!==0n || m.amount!==1n || t.from!=="0x0000000000000000000000000000000000000000" || t.to.toLowerCase()!==address || t.id.toString()!==id || t.value!==1n || await this.chain.contracts.LicenseNFT.balanceOf(address,id,{blockTag:receipt.blockNumber})<1n) throw new AppError(409,"NFT/event ownership mismatch");
    const shares=request.contributorSnapshot as Array<{userId:number;walletAddress:string;percentage:string}>;
    const [addresses, percentages] = await this.chain.contracts.TrackRegistry.getContributors(id,{blockTag:receipt.blockNumber});
    if(addresses.length!==shares.length || shares.some((s,i)=>s.walletAddress.toLowerCase()!==addresses[i].toLowerCase() || new Prisma.Decimal(s.percentage).toFixed()!==percentages[i].toString())) throw new AppError(409,"On-chain shares differ from purchase snapshot");
    const allocations=this.chain.events(receipt,"RevenueSplitter","RevenueAllocated");
    let total=0n;
    const rows=shares.map((s,i)=>{
      const amount=i===shares.length-1?transaction.value-total:transaction.value*BigInt(new Prisma.Decimal(s.percentage).toFixed())/100n; total+=amount;
      const e=allocations[i]?.args;
      if(allocations.length!==shares.length || !e || e.trackId.toString()!==id || e.creator.toLowerCase()!==s.walletAddress.toLowerCase() || e.amount!==amount) throw new AppError(409,"Splitter allocation mismatch");
      return {userId:s.userId,percentage:s.percentage,amount:formatEther(amount),currency:"ETH" as const};
    });
    return {...expected,source:"REAL",paymentReference:`chain:${this.chain.chainId}:${this.txHash.toLowerCase()}`,paymentConfirmed:true,mintConfirmed:true,txHash:this.txHash.toLowerCase(),tokenId:id,chainId:this.chain.chainId,blockNumber:BigInt(receipt.blockNumber),allocations:rows};
  }
}
export class ChainCommerce {
  readonly repo: RightsRepository;
  constructor(readonly db: PrismaClient, readonly chain: ChainClient) { this.repo=new RightsRepository(db); }
  async registered(id:number,userId?:number,owner=false) {
    await this.chain.ready();
    const track=await this.repo.track(id,userId,owner);
    eligibleTrack(track,true);
    if(track.registrationRequests[0]?.contractAddress?.toLowerCase()!==this.chain.addresses.TrackRegistry.toLowerCase() || track.registrationRequests[0]?.chainId!==this.chain.chainId || !track.blockchainTrackId) throw new AppError(409,"Track belongs to a different deployment");
    const proof=await this.chain.contracts.TrackRegistry.getTrack(track.blockchainTrackId);
    if(proof.audioHash!==`0x${track.audioHash}` || proof.metadataCID!==track.metadataCid || proof.registrant.toLowerCase()!==wallet(track.owner.walletAddress) || !await this.chain.contracts.TrackRegistry.isTrackLicensable(track.blockchainTrackId)) throw new AppError(409,"On-chain track differs or is HOLD");
    return track;
  }
  async price(id:number,userId:number,value:unknown) {
    const input=body(value,["price"]);
    const listing=await this.db.marketplaceListing.findUnique({where:{id}});
    if(!listing) throw new AppError(404,"Listing not found");
    if(listing.sellerId!==userId) throw new AppError(403,"Listing belongs to another creator");
    const track=await this.registered(listing.trackId,userId,true);
    if(listing.currency!=="ETH" || listing.licenseType!=="COMMERCIAL") throw new AppError(409,"Contract supports ETH COMMERCIAL licenses only");
    let price:bigint;
    try {price=ethWei(String(input.price??listing.price));} catch {throw new AppError(400,"Invalid ETH price");}
    if(price<=0n || price>=2n**256n) throw new AppError(400,"Price must be positive uint256 wei");
    return {listingId:id,priceWei:price.toString(),price:formatEther(price),currency:"ETH",transaction:this.chain.tx("LicenseMarketplace","setLicensePrice",[track.blockchainTrackId,price],wallet(track.owner.walletAddress))};
  }
  async marketState(id:number,userId?:number) {
    const listing=await this.db.marketplaceListing.findUniqueOrThrow({where:{id}}),track=await this.registered(listing.trackId,userId);
    const price=await this.chain.contracts.LicenseMarketplace.getLicensePrice(track.blockchainTrackId);
    return {priceWei:price.toString(),price:formatEther(price),currency:"ETH",purchasable:listing.status==="ACTIVE" && listing.currency==="ETH" && listing.licenseType==="COMMERCIAL" && price>0n && ethWei(listing.price.toString())===price};
  }
  async purchase(userId:number,value:unknown,headerKey?:unknown) {
    const input=body(value,["trackId","licenseType","amount","currency","preparation","idempotencyKey"]);
    const track=await this.registered(trackId(input.trackId),userId);
    if(input.preparation || input.licenseType && input.licenseType!=="COMMERCIAL" || input.currency && input.currency!=="ETH") throw new AppError(400,"Use COMMERCIAL ETH without preparation for chain purchases");
    const address=wallet((await this.db.user.findUniqueOrThrow({where:{id:userId}})).walletAddress);
    if(await this.chain.contracts.LicenseNFT.hasLicense(address,track.blockchainTrackId)) throw new AppError(409,"Wallet already has this license");
    const price:bigint=await this.chain.contracts.LicenseMarketplace.getLicensePrice(track.blockchainTrackId);
    if(price<=0n) throw new AppError(409,"On-chain price is not set");
    if(input.amount!==undefined && ethWei(String(input.amount))!==price) throw new AppError(409,"Amount differs from chain price");
    const service=new LicenseService(this.repo,new ChainPaymentProvider(this.db,this.chain,""));
    const request=await service.purchase(userId,{...input,licenseType:"COMMERCIAL",currency:"ETH",amount:formatEther(price)},headerKey);
    if(request.currency!=="ETH" || ethWei(request.price.toString())!==price) throw new AppError(409,"Listing price differs from chain price; synchronize first");
    return {...request,priceWei:price.toString(),transaction:this.chain.tx("LicenseMarketplace","purchaseLicense",[track.blockchainTrackId],address,price)};
  }
  async confirm(userId:number,value:unknown) {
    const input=body(value,["requestId","txHash"]), id=trackId(input.requestId);
    if(typeof input.txHash!=="string") throw new AppError(400,"txHash is required");
    const request=await this.db.purchaseRequest.findUniqueOrThrow({where:{id},include:{transaction:true}});
    if(request.buyerId!==userId) throw new AppError(403,"Purchase belongs to another buyer");
    if(request.status==="COMPLETED" && request.transaction?.txHash?.toLowerCase()!==input.txHash.toLowerCase()) throw new AppError(409,"Purchase already confirmed with another transaction");
    const provider=new ChainPaymentProvider(this.db,this.chain,input.txHash);
    await provider.verifyPayment({requestId:id,buyerId:userId,trackId:request.trackId,licenseType:request.licenseType,amount:request.price.toString(),currency:request.currency,preparation:request.preparation});
    return new LicenseService(this.repo,provider).reconcile(id,userId);
  }
  async revenue(userId:number) {
    await this.chain.ready();
    const address=wallet((await this.db.user.findUniqueOrThrow({where:{id:userId}})).walletAddress);
    const amount=await this.chain.contracts.RevenueSplitter.getPendingRevenue(address);
    const summary=await new RevenueService(this.repo).summary(userId);
    return {...summary,withdrawalSupported:true,availableWei:amount.toString(),available:formatEther(amount),currency:"ETH",walletAddress:address};
  }
  async withdraw(userId:number,value:unknown) {
    const input=body(value??{},["amount","currency","idempotencyKey"]), balance=await this.revenue(userId);
    if(BigInt(balance.availableWei)===0n) throw new AppError(409,"No pending on-chain revenue");
    if(input.currency && input.currency!=="ETH" || input.amount && ethWei(String(input.amount))!==BigInt(balance.availableWei)) throw new AppError(400,"Contract withdraws the full ETH balance");
    const request=await new RevenueService(this.repo).withdraw(userId,{amount:balance.available,currency:"ETH",idempotencyKey:input.idempotencyKey},balance.walletAddress);
    if(request.status!=="PREPARING" && request.status!=="PENDING") return {...request,supported:true};
    return {...request,supported:true,transaction:this.chain.tx("RevenueSplitter","withdrawRevenue",[],balance.walletAddress)};
  }
  async confirmWithdrawal(userId:number,value:unknown) {
    const input=body(value,["requestId","txHash"]),id=trackId(input.requestId);
    if(typeof input.txHash!=="string") throw new AppError(400,"txHash is required");
    const row=await this.db.revenueWithdrawal.findUniqueOrThrow({where:{id}});
    if(row.userId!==userId) throw new AppError(403,"Withdrawal belongs to another user");
    if(row.status==="COMPLETED" && row.txHash?.toLowerCase()!==input.txHash.toLowerCase()) throw new AppError(409,"Already confirmed with another transaction");
    const address=wallet(row.walletAddress);
    const {receipt,transaction}=await this.chain.receipt(input.txHash,"RevenueSplitter",address);
    const call=this.chain.interfaces.RevenueSplitter.parseTransaction({data:transaction.data,value:transaction.value}), events=this.chain.events(receipt,"RevenueSplitter","RevenueWithdrawn");
    if(call?.name!=="withdrawRevenue" || transaction.value!==0n || events.length!==1 || events[0].args.creator.toLowerCase()!==address || row.currency!=="ETH" || events[0].args.amount<=0n) throw new AppError(409,"Withdrawal event differs from request");
    const actualAmount=formatEther(events[0].args.amount);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM User WHERE id=${userId} FOR UPDATE`;
      const current=await tx.revenueWithdrawal.findUniqueOrThrow({where:{id}});
      if(current.status === "COMPLETED") {
        if(current.txHash?.toLowerCase() !== (input.txHash as string).toLowerCase()) throw new AppError(409,"Withdrawal already confirmed with another transaction");
        return current;
      }
      if(!["PREPARING","PENDING"].includes(current.status)) throw new AppError(409,"Withdrawal request is terminal");
      const duplicate=await tx.revenueWithdrawal.findFirst({where:{txHash:input.txHash as string,id:{not:id}}});
      if(duplicate) throw new AppError(409,"Withdrawal transaction already consumed");
      // withdrawRevenue pays the balance at execution, which can grow after preparation.
      return tx.revenueWithdrawal.update({where:{id},data:{amount:actualAmount,status:"COMPLETED",txHash:(input.txHash as string).toLowerCase(),confirmedAt:new Date()}});
    });
  }
}
