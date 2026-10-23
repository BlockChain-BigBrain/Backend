import "../config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, FetchRequest, keccak256, TypedDataEncoder, getAddress, TransactionReceipt, TransactionResponse } from "ethers";
import { AppError } from "../utils/errors";
import { BlockchainProvider, RegistrationExpectation, RegistrationReceipt } from "../providers/blockchain.provider";

export const names = ["TrackRegistry", "LicenseNFT", "LicenseMarketplace", "RevenueSplitter"] as const;
export type ContractName = typeof names[number];
const envNames: Record<ContractName, string> = { TrackRegistry: "TRACK_REGISTRY_ADDRESS", LicenseNFT: "LICENSE_NFT_ADDRESS", LicenseMarketplace: "LICENSE_MARKETPLACE_ADDRESS", RevenueSplitter: "REVENUE_SPLITTER_ADDRESS" };
export class ChainClient implements BlockchainProvider {
  blockedReason?: string;
  readonly configured: boolean;
  readonly provider: JsonRpcProvider;
  readonly chainId: string;
  readonly confirmations: number;
  readonly contracts = {} as Record<ContractName, Contract>;
  readonly interfaces = {} as Record<ContractName, Interface>;
  readonly addresses = {} as Record<ContractName, string>;
  readonly manifest: any;
  constructor() {
    this.configured = process.env.BLOCKCHAIN_NETWORK === "hardhat";
    this.chainId = process.env.BLOCKCHAIN_CHAIN_ID ?? "31337";
    if (this.configured && this.chainId !== "31337") throw new Error("Only local Hardhat chain 31337 is supported");
    const url = process.env.BLOCKCHAIN_RPC_URL ?? "http://127.0.0.1:8545";
    const parsed = new URL(url);
    if (this.configured && (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.protocol !== "http:" || parsed.username || parsed.password)) throw new Error("Hardhat RPC must be local HTTP");
    const request = new FetchRequest(url); request.timeout = 5000;
    this.provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
    this.confirmations = Number(process.env.BLOCKCHAIN_CONFIRMATIONS ?? 2);
    const root = __dirname;
    try { this.manifest = JSON.parse(readFileSync(path.join(root, "deployment.json"), "utf8")); } catch { this.manifest = null; }
    for (const name of names) {
      const abi = JSON.parse(readFileSync(path.join(root, "abi", `${name}.json`), "utf8"));
      this.interfaces[name] = new Interface(abi);
      const address = process.env[envNames[name]];
      if (address) {
        this.addresses[name] = getAddress(address);
        this.contracts[name] = new Contract(address, abi, this.provider);
      }
    }
  }
  async health() {
    const contracts = Object.fromEntries(names.map(name => [name, false]));
    if(this.blockedReason) return {connected:false,chainId:this.chainId,contracts,error:this.blockedReason};
    if (!this.configured) return { connected: false, chainId: this.chainId, contracts, error: "BLOCKCHAIN_NETWORK is unconfigured" };
    try {
      const network = await this.provider.getNetwork();
      if (network.chainId.toString() !== this.chainId) throw new Error("RPC chain ID mismatch");
      if (!this.manifest || this.manifest.chainId !== this.chainId) throw new Error("Import a live deployment manifest first");
      for (const name of names) {
        const address = this.addresses[name];
        if (!address || address.toLowerCase() !== this.manifest[name]?.toLowerCase()) throw new Error(`${name} address mismatch`);
        const code = await this.provider.getCode(address);
        if (code === "0x" || keccak256(code) !== this.manifest.runtimeCodeHashes?.[name]) throw new Error(`${name} runtime code mismatch; redeploy/import after node restart`);
        contracts[name] = true;
      }
      const r = this.contracts.TrackRegistry, m = this.contracts.LicenseMarketplace;
      const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      if (!same(await r.verificationSigner(), process.env.VERIFICATION_SIGNER_ADDRESS ?? "") || !same(await m.registry(), this.addresses.TrackRegistry) || !same(await m.licenseNFT(), this.addresses.LicenseNFT) || !same(await m.revenueSplitter(), this.addresses.RevenueSplitter) || !same(await this.contracts.LicenseNFT.marketplace(), this.addresses.LicenseMarketplace) || !same(await this.contracts.RevenueSplitter.marketplace(), this.addresses.LicenseMarketplace)) throw new Error("Contract wiring/verifier mismatch");
      const genesis = await this.provider.getBlock(0);
      const anchor = await this.provider.getBlock(this.manifest.anchorBlock);
      if (genesis?.hash !== this.manifest.genesisHash || anchor?.hash !== this.manifest.anchorHash) throw new Error("Deployment chain restarted; import fresh deployment");
      return { connected: true, chainId: this.chainId, contracts };
    } catch (error) { return { connected: false, chainId: this.chainId, contracts, error: error instanceof Error && !error.message.includes("http") ? error.message.slice(0, 180) : "RPC unavailable" }; }
  }
  async ready() {
    const health = await this.health();
    if (!health.connected) throw new AppError(503, health.error ?? "Blockchain unavailable");
  }
  tx(name: ContractName, fn: string, args: unknown[], from: string, value = 0n) {
    return { chainId: this.chainId, from: getAddress(from), to: this.addresses[name], data: this.interfaces[name].encodeFunctionData(fn, args), value: value.toString(), valueUnit: "wei" };
  }
  async receipt(hash: string, name: ContractName, from?: string): Promise<{ receipt: TransactionReceipt; transaction: TransactionResponse }> {
    if (!/^0x[\da-f]{64}$/i.test(hash)) throw new AppError(400, "Invalid transaction hash");
    await this.ready();
    const [receipt, transaction] = await Promise.all([this.provider.getTransactionReceipt(hash), this.provider.getTransaction(hash)]);
    if (!receipt || !transaction) throw new AppError(409, "Transaction is not mined");
    if (receipt.status !== 1 || transaction.chainId.toString() !== this.chainId || transaction.to?.toLowerCase() !== this.addresses[name].toLowerCase() || from && transaction.from.toLowerCase() !== from.toLowerCase()) throw new AppError(409, "Transaction failed or sender/contract mismatch");
    if (await receipt.confirmations() < this.confirmations) throw new AppError(409, "Transaction needs more confirmations");
    const canonical = await this.provider.getBlock(receipt.blockNumber);
    if (canonical?.hash !== receipt.blockHash) throw new AppError(409, "Transaction block is not canonical");
    return { receipt, transaction };
  }
  events(receipt: TransactionReceipt, name: ContractName, event: string) {
    return receipt.logs.filter(log => log.address.toLowerCase() === this.addresses[name].toLowerCase()).flatMap(log => {
      try { const parsed = this.interfaces[name].parseLog(log); return parsed?.name === event ? [{ log, args: parsed.args }] : []; } catch { return []; }
    });
  }
  async registrationNonce(txHash: string, registrant: string) {
    const {transaction}=await this.receipt(txHash,"TrackRegistry",registrant);
    const call=this.interfaces.TrackRegistry.parseTransaction({data:transaction.data,value:transaction.value});
    if(call?.name!=="registerTrack") throw new AppError(409,"Not a registration transaction");
    return call.args[0].nonce.toString();
  }
  async verifyRegistration(expected: RegistrationExpectation): Promise<RegistrationReceipt> {
    const { receipt, transaction } = await this.receipt(expected.txHash, "TrackRegistry", expected.registrant);
    const call = this.interfaces.TrackRegistry.parseTransaction({ data: transaction.data, value: transaction.value });
    if (call?.name !== "registerTrack" || expected.chainId !== this.chainId || expected.contractAddress.toLowerCase() !== this.addresses.TrackRegistry.toLowerCase()) throw new AppError(409, "Wrong registration transaction");
    const r = call.args[0];
    const value = { audioHash: r.audioHash, metadataCIDHash: keccak256(Buffer.from(r.metadataCID)), registrant: transaction.from, contributorsHash: keccak256((await import("ethers")).AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]"], [r.contributors, r.shares])), similarityScore: r.similarityScore, modelVersion: r.modelVersion, nonce: r.nonce, deadline: r.deadline };
    const types = { RegisterTrack: [{name:"audioHash",type:"bytes32"},{name:"metadataCIDHash",type:"bytes32"},{name:"registrant",type:"address"},{name:"contributorsHash",type:"bytes32"},{name:"similarityScore",type:"uint256"},{name:"modelVersion",type:"string"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}] };
    const digest = TypedDataEncoder.hash({name:"TrackAI_Registry",version:"1",chainId:this.chainId,verifyingContract:this.addresses.TrackRegistry}, types, value);
    const events = this.events(receipt, "TrackRegistry", "TrackRegistered"), verified = this.events(receipt, "TrackRegistry", "VerificationRecorded");
    if (r.nonce.toString() !== expected.nonce || digest !== expected.payloadDigest || events.length !== 1 || verified.length !== 1) throw new AppError(409, "Registration proof differs from signed request");
    const e = events[0].args, v = verified[0].args;
    if (e.creator.toLowerCase() !== expected.registrant.toLowerCase() || e.audioHash !== r.audioHash || e.metadataCID !== r.metadataCID || e.trackId !== v.trackId || v.similarityScore !== r.similarityScore || v.modelVersion !== r.modelVersion) throw new AppError(409, "Registration event mismatch");
    return { ...expected, source: "REAL", confirmed: true, confirmations: await receipt.confirmations(), blockchainTrackId: e.trackId.toString() };
  }
}
export const chainClient = new ChainClient();
