import { getAddress } from "ethers";
import { ContributionRole, Prisma } from "@prisma/client";
import { RightsRepository, mutable, own } from "../repositories/rights.repository";
import { AppError } from "../utils/errors";

type InviteInput = { email?: string; walletAddress?: string; role?: string; percentage?: number };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvitationService {
  constructor(private readonly repo: RightsRepository) {}

  async forTrack(trackId: number, ownerId: number) {
    await this.repo.track(trackId, ownerId, true);
    return this.repo.db.contributionInvitation.findMany({ where: { trackId }, orderBy: { id: "asc" } });
  }

  async inbox(userId: number) {
    const user = await this.repo.db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, walletAddress: true } });
    const matches: Prisma.ContributionInvitationWhereInput[] = [{ email: user.email.toLowerCase() }];
    if (user.walletAddress) matches.push({ walletAddress: user.walletAddress.toLowerCase() });
    return this.repo.db.contributionInvitation.findMany({
      where: { status: "PENDING", OR: matches },
      include: { track: { select: { id: true, title: true, ownerId: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(trackId: number, inviterId: number, raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError(400, "Invalid invitation");
    const data = raw as InviteInput;
    if ((!!data.email) === (!!data.walletAddress)) throw new AppError(400, "Provide exactly one email or walletAddress");
    if (data.role !== "VOCAL") throw new AppError(400, "Only VOCAL invitations are supported");
    if (typeof data.percentage !== "number" || !Number.isFinite(data.percentage) || data.percentage <= 0 || data.percentage > 100 || !/^\\d+(\\.\\d{1,2})?$/.test(String(data.percentage))) throw new AppError(400, "Invalid percentage");
    const email = data.email?.trim().toLowerCase();
    if (email && (!emailPattern.test(email) || email.length > 191)) throw new AppError(400, "Invalid email");
    let walletAddress: string | undefined;
    if (data.walletAddress) {
      try { walletAddress = getAddress(data.walletAddress.trim()).toLowerCase(); }
      catch { throw new AppError(400, "Invalid wallet address"); }
    }
    const record = await this.repo.locked(trackId, async (tx, track) => {
      own(track, inviterId); mutable(track);
      if (track.contributionsFinalizedAt) throw new AppError(409, "Contributions already finalized");
      const pending = await tx.contributionInvitation.findMany({ where: { trackId, status: "PENDING" } });
      if (pending.some(x => (email && x.email === email) || (walletAddress && x.walletAddress === walletAddress))) throw new AppError(409, "Invitation already pending");
      const committed = track.contributions.reduce((sum, x) => sum.plus(x.percentage), new Prisma.Decimal(0));
      const reserved = pending.reduce((sum, x) => sum.plus(x.percentage), new Prisma.Decimal(0));
      if (committed.plus(reserved).plus(data.percentage!).gt(100)) throw new AppError(400, "Contribution total exceeds 100%");
      return tx.contributionInvitation.create({ data: { trackId, inviterId, email, walletAddress, role: ContributionRole.VOCAL, percentage: new Prisma.Decimal(data.percentage!) } });
    });
    if (email) {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM_EMAIL;
      if (!apiKey || !from) {
        await this.repo.db.contributionInvitation.delete({ where: { id: record.id } });
        throw new AppError(503, "Email delivery is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)");
      }
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from, to: [email], subject: "Track-AI 보이스 제공자 초대",
            text: `Track-AI에서 음원 기여자로 초대되었습니다. 로그인 후 받은 초대함에서 확인하고 수락해 주세요. 음원 ID: ${trackId}, 기여도: ${data.percentage}%\n${process.env.FRONTEND_URL || "http://localhost:8443/Frontend/"}`,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
      } catch {
        await this.repo.db.contributionInvitation.deleteMany({ where: { id: record.id, status: "PENDING" } });
        throw new AppError(502, "Invitation email could not be delivered");
      }
    }
    return { ...record, delivery: email ? "EMAIL_SUBMITTED" : "IN_APP_PENDING" };
  }

  async respond(invitationId: number, userId: number, status: "ACCEPTED" | "REJECTED") {
    const invitation = await this.repo.db.contributionInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new AppError(404, "Invitation not found");
    return this.repo.locked(invitation.trackId, async (tx, track) => {
      mutable(track);
      if (track.contributionsFinalizedAt) throw new AppError(409, "Contributions already finalized");
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, walletAddress: true } });
      if (invitation.email !== user.email.toLowerCase() && (!invitation.walletAddress || invitation.walletAddress !== user.walletAddress?.toLowerCase())) throw new AppError(403, "Invitation does not belong to this account");
      const current = await tx.contributionInvitation.findUniqueOrThrow({ where: { id: invitationId } });
      if (current.status !== "PENDING") throw new AppError(409, "Invitation is no longer pending");
      if (status === "ACCEPTED") {
        if (track.contributions.some(x => x.userId === userId && x.role === current.role)) throw new AppError(409, "Contributor already exists");
        const total = track.contributions.reduce((sum, x) => sum.plus(x.percentage), new Prisma.Decimal(0)).plus(current.percentage);
        if (total.gt(100)) throw new AppError(409, "Contribution total exceeds 100%");
        await tx.contribution.create({ data: { trackId: current.trackId, userId, role: current.role, percentage: current.percentage } });
      }
      return tx.contributionInvitation.update({ where: { id: invitationId }, data: { status, acceptedAt: status === "ACCEPTED" ? new Date() : null } });
    });
  }

  async cancel(invitationId: number, userId: number) {
    const invitation = await this.repo.db.contributionInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation) throw new AppError(404, "Invitation not found");
    return this.repo.locked(invitation.trackId, async (tx, track) => {
      own(track, userId); mutable(track);
      if (invitation.status !== "PENDING") throw new AppError(409, "Only pending invitations can be cancelled");
      return tx.contributionInvitation.update({ where: { id: invitationId }, data: { status: "CANCELLED" } });
    });
  }
}
