import { PrismaClient } from "@prisma/client";
import { formatEther } from "ethers";
import { ChainClient, names } from "./client";
import { ChainCommerce } from "./commerce";
import { BlockchainService, blockchainOptions } from "../services/blockchain.service";
import { RightsRepository } from "../repositories/rights.repository";
import { AppError } from "../utils/errors";
const watched = new Set(["TrackRegistered","VerificationRecorded","LicensePriceUpdated","LicensePurchased","LicenseMinted","RevenueAllocated","RevenueWithdrawn"]);
const safe = (v:unknown) => JSON.parse(JSON.stringify(v,(_k,x)=>typeof x==="bigint"?x.toString():x));
export class ChainSync {
  private running=false;
  constructor(private db:PrismaClient,private chain:ChainClient,private commerce:ChainCommerce) {}
  async process(hash:string) {
    await this.chain.ready();
    const receipt=await this.chain.provider.getTransactionReceipt(hash);
    if(!receipt || receipt.status!==1 || await receipt.confirmations()<this.chain.confirmations) throw new AppError(409,"Unconfirmed event receipt");
    const block=await this.chain.provider.getBlock(receipt.blockNumber);
    if(block?.hash!==receipt.blockHash) throw new AppError(409,"Reorg detected");
    const pending=[];
    for(const log of receipt.logs) {
      const name=names.find(n=>this.chain.addresses[n].toLowerCase()===log.address.toLowerCase());
      if(!name) continue;
      const parsed=this.chain.interfaces[name].parseLog(log);
      if(!parsed || !watched.has(parsed.name)) continue;
      const payload=Object.fromEntries(parsed.fragment.inputs.map((f,i)=>[f.name,safe(parsed.args[i])]));
      const key={chainId:this.chain.chainId,transactionHash:hash.toLowerCase(),logIndex:log.index};
      const saved=await this.db.blockchainEvent.upsert({where:{chainId_transactionHash_logIndex:key},create:{...key,contractAddress:log.address.toLowerCase(),eventName:parsed.name,blockNumber:BigInt(log.blockNumber),blockHash:log.blockHash,payload},update:{}});
      if(saved.blockHash!==log.blockHash) {
        this.chain.blockedReason="Previously indexed event was reorganized; reconcile DB before resuming";
        throw new AppError(503,this.chain.blockedReason);
      }
      if(!saved.processedAt) pending.push({...saved,contract:name,args:parsed.args});
    }
    if(!pending.length) return;
    try {
      // Validate companion relationships before applying any business state.
      const hasPurchase=this.chain.events(receipt,"LicenseMarketplace","LicensePurchased").length===1;
      const hasRegistration=this.chain.events(receipt,"TrackRegistry","TrackRegistered").length===1;
      if(pending.some(e=>["LicenseMinted","RevenueAllocated"].includes(e.eventName)) && !hasPurchase || pending.some(e=>e.eventName==="VerificationRecorded") && !hasRegistration) throw new AppError(409,"Orphan companion event");
      for(const event of pending) {
        const a=event.args;
        if(event.eventName==="TrackRegistered") {
          const track=await this.db.track.findFirst({where:{audioHash:a.audioHash.slice(2)},include:{registrationRequests:{orderBy:{id:"desc"},take:1}}});
          const request=track?.registrationRequests[0];
          if(!track || !request || request.contractAddress?.toLowerCase()!==this.chain.addresses.TrackRegistry.toLowerCase()) throw new AppError(409,"No matching backend registration request");
          await new BlockchainService(new RightsRepository(this.db),this.chain,blockchainOptions()).confirm(track.id,track.ownerId,hash);
        } else if(event.eventName==="LicensePriceUpdated") {
          const track=await this.db.track.findFirst({where:{blockchainTrackId:a.trackId.toString(),registrationRequests:{some:{source:"REAL",chainId:this.chain.chainId,contractAddress:this.chain.addresses.TrackRegistry.toLowerCase()}}}});
          if(!track) throw new AppError(409,"Price event has no registered backend track");
          // Read only confirmed state; a newer unconfirmed price must not enter the DB.
          const confirmedBlock=await this.chain.provider.getBlockNumber()-this.chain.confirmations+1;
          const price=await this.chain.contracts.LicenseMarketplace.getLicensePrice(a.trackId,{blockTag:confirmedBlock});
          await this.db.$transaction(async tx=>{
            await tx.$queryRaw`SELECT id FROM Track WHERE id=${track.id} FOR UPDATE`;
            const listing=await tx.marketplaceListing.findFirst({where:{trackId:track.id,status:{in:["PREPARING","ACTIVE"]}},orderBy:{id:"desc"}});
            if(!listing || listing.currency!=="ETH" || listing.licenseType!=="COMMERCIAL") throw new AppError(409,"No matching ETH COMMERCIAL listing");
            await tx.marketplaceListing.update({where:{id:listing.id},data:{price:formatEther(price),status:"ACTIVE",activeTrackId:track.id}});
          });
        } else if(event.eventName==="LicensePurchased") {
          const request=await this.db.purchaseRequest.findFirst({where:{preparation:false,buyerWalletAddress:a.buyer.toLowerCase(),track:{blockchainTrackId:a.trackId.toString()},status:{in:["PENDING_PAYMENT","PENDING_MINT","COMPLETED"]}},orderBy:{id:"desc"}});
          if(!request) throw new AppError(409,"No matching backend purchase request");
          await this.commerce.confirm(request.buyerId,{requestId:request.id,txHash:hash});
        } else if(event.eventName==="RevenueWithdrawn") {
          const request=await this.db.revenueWithdrawal.findFirst({where:{walletAddress:a.creator.toLowerCase(),currency:"ETH",OR:[{status:{in:["PREPARING","PENDING"]}},{txHash:hash.toLowerCase()}]},orderBy:{id:"asc"}});
          if(!request) throw new AppError(409,"No matching withdrawal request");
          await this.commerce.confirmWithdrawal(request.userId,{requestId:request.id,txHash:hash});
        }
      }
      await this.db.blockchainEvent.updateMany({where:{id:{in:pending.map(e=>e.id)}},data:{processedAt:new Date(),error:null,attempts:{increment:1}}});
    } catch(error) {
      await this.db.blockchainEvent.updateMany({where:{id:{in:pending.map(e=>e.id)}},data:{error:"Receipt mapping/validation failed; retry pending",attempts:{increment:1}}});
      throw error;
    }
  }
  async poll() {
    if(this.running || !this.chain.configured) return;
    this.running=true;
    try {
      await this.chain.ready();
      const key=this.chain.chainId;
      const cursor=await this.db.blockchainCursor.findUnique({where:{chainId:key}});
      if(cursor && (await this.chain.provider.getBlock(Number(cursor.blockNumber)))?.hash!==cursor.blockHash) {
        this.chain.blockedReason="Finalized cursor reorg/restart detected; reconcile DB before resuming";
        throw new AppError(503,this.chain.blockedReason);
      }
      const latest=await this.chain.provider.getBlockNumber(), end=latest-this.chain.confirmations+1;
      const start=cursor?Number(cursor.blockNumber)+1:Number(process.env.BLOCKCHAIN_START_BLOCK??0);
      const retry=await this.db.blockchainEvent.findMany({where:{chainId:key,processedAt:null},distinct:["transactionHash"],orderBy:[{attempts:"asc"},{blockNumber:"asc"}],take:100});
      for(const event of retry) {try {await this.process(event.transactionHash);} catch { /* persisted retry */ }}
      if(end<start) return;
      const to=Math.min(end,start+199);
      const anchor=await this.chain.provider.getBlock(to);
      if(!anchor?.hash) throw new AppError(503,"Sync block unavailable");
      const logs=await this.chain.provider.getLogs({address:names.map(n=>this.chain.addresses[n]),fromBlock:start,toBlock:to});
      // A failed mapping can advance only when its retry inbox is durable. RPC/DB
      // failures before persistence must leave the scan cursor unchanged.
      const ordered=logs.sort((a,b)=>a.blockNumber-b.blockNumber || a.transactionIndex-b.transactionIndex || a.index-b.index);
      for(const hash of [...new Set(ordered.map(log=>log.transactionHash))]) {
        try {await this.process(hash);} catch(error) {
          if(this.chain.blockedReason || !await this.db.blockchainEvent.count({where:{chainId:key,transactionHash:hash.toLowerCase(),processedAt:null}})) throw error;
          console.error(JSON.stringify({event:"blockchain_sync_retry",txHash:hash}));
        }
      }
      const block=await this.chain.provider.getBlock(to);
      if(!block?.hash || block.hash!==anchor.hash) {
        this.chain.blockedReason="Chain changed during event scan; reconcile DB before resuming";
        throw new AppError(503,this.chain.blockedReason);
      }
      await this.db.blockchainCursor.upsert({where:{chainId:key},create:{chainId:key,blockNumber:BigInt(to),blockHash:block.hash},update:{blockNumber:BigInt(to),blockHash:block.hash}});
    } finally {this.running=false;}
  }
  start(interval=3000) {
    const tick=()=>void this.poll().catch(()=>console.error(JSON.stringify({event:"blockchain_sync_unavailable"})));
    tick(); const timer=setInterval(tick,interval);timer.unref();return()=>clearInterval(timer);
  }
}
