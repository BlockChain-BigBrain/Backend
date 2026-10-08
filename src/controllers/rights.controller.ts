import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { trackId } from "../dto/track.dto";
import { body, string } from "../dto/rights.dto";
import { RightsServices } from "../services/rights.services";

export function jsonSafe(value: unknown) { return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)); }
export class RightsController {
  constructor(readonly services: RightsServices) {}
  handler(action: (services: RightsServices, req: AuthenticatedRequest, id: number, userId: number) => Promise<unknown>, status = 200) {
    return async (req: AuthenticatedRequest, res: Response) => {
      const result = await action(this.services, req, req.params.id === undefined ? 0 : trackId(req.params.id), req.userId!);
      if (status === 204) { res.status(204).end(); return; }
      res.status(status).json(jsonSafe(result));
    };
  }
  readonly wallet = this.handler((s, _req, _id, userId) => s.wallet.current(userId));
  readonly walletChallenge = this.handler((s, req, _id, userId) => s.wallet.challenge(userId, req.body), 201);
  readonly bindWallet = this.handler((s, req, _id, userId) => s.wallet.bind(userId, req.body));
  readonly contributors = this.handler((s, req, id) => s.contributions.list(id, req.userId));
  readonly addContributor = this.handler((s, req, id, userId) => s.contributions.change(id, userId, "create", req.body), 201);
  readonly updateContributor = this.handler((s, req, id, userId) => s.contributions.change(id, userId, "update", req.body, trackId(req.params.contributionId)));
  readonly deleteContributor = this.handler((s, req, id, userId) => s.contributions.change(id, userId, "delete", undefined, trackId(req.params.contributionId)), 204);
  readonly finalize = this.handler((s, _req, id, userId) => s.contributions.finalize(id, userId));
  readonly verify = this.handler((s, _req, id, userId) => s.verifications.request(id, userId), 202);
  readonly reverify = this.handler((s, _req, id, userId) => s.verifications.request(id, userId, true), 202);
  readonly verification = this.handler((s, req, id) => s.verifications.latest(id, req.userId));
  readonly verifications = this.handler((s, _req, id, userId) => s.verifications.history(id, userId));
  readonly metadata = this.handler((s, _req, id, userId) => s.metadata.preview(id, userId));
  readonly prepareMetadata = this.handler((s, req, id, userId) => s.metadata.prepare(id, userId, req.body ?? {}), 201);
  readonly ipfs = this.handler((s, _req, id, userId) => s.metadata.status(id, userId));
  readonly register = this.handler((s, _req, id, userId) => s.blockchain.register(id, userId), 202);
  readonly payload = this.handler((s, _req, id, userId) => s.blockchain.payload(id, userId));
  readonly blockchain = this.handler((s, _req, id, userId) => s.blockchain.status(id, userId));
  readonly confirm = this.handler((s, req, id, userId) => s.blockchain.confirm(id, userId, string(body(req.body, ["txHash"]).txHash, "txHash", 66)));
  readonly cancelRegistration = this.handler((s, _req, id, userId) => s.blockchain.cancel(id, userId));
  readonly marketCreate = this.handler((s, req, _id, userId) => s.marketplace.create(userId, req.body), 201);
  readonly marketList = this.handler((s, req) => s.marketplace.list(req.query, req.userId));
  readonly marketGet = this.handler((s, req, id) => s.marketplace.get(id, req.userId));
  readonly marketUpdate = this.handler((s, req, id, userId) => s.marketplace.update(id, userId, req.body));
  readonly marketDelete = this.handler((s, _req, id, userId) => s.marketplace.update(id, userId, { status: "INACTIVE" }), 204);
  readonly purchase = this.handler((s, req, _id, userId) => s.licenses.purchase(userId, req.body, req.headers["idempotency-key"]), 201);
  readonly purchaseStatus = this.handler((s, _req, id, userId) => s.licenses.request(id, userId));
  readonly cancelPurchase = this.handler((s, _req, id, userId) => s.licenses.cancel(id, userId));
  readonly reconcile = this.handler((s, _req, id, userId) => s.licenses.reconcile(id, userId));
  readonly licenses = this.handler((s, req, _id, userId) => s.licenses.list(userId, req.query));
  readonly license = this.handler((s, _req, id, userId) => s.licenses.detail(id, userId));
  readonly licenseStatus = this.handler((s, _req, id, userId) => s.licenses.request(id, userId));
  readonly transactions = this.handler((s, req, _id, userId) => s.transactions.list(userId, req.query));
  readonly transaction = this.handler((s, _req, id, userId) => s.transactions.detail(id, userId));
  readonly revenue = this.handler((s, _req, _id, userId) => s.revenue.summary(userId));
  readonly revenueHistory = this.handler((s, req, _id, userId) => s.revenue.history(userId, req.query));
  readonly withdraw = this.handler((s, req, _id, userId) => s.revenue.withdraw(userId, req.body), 202);
}
