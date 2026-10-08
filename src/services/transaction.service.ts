import { pagination } from "../dto/rights.dto";
import { RightsRepository } from "../repositories/rights.repository";
import { AppError } from "../utils/errors";
export class TransactionService {
  constructor(private readonly repo: RightsRepository) {}
  async list(userId: number, value: unknown) {
    const { page, limit, skip } = pagination(value);
    const where = { userId };
    const [items, total] = await this.repo.db.$transaction([this.repo.db.transaction.findMany({ where, orderBy: { id: "desc" }, skip, take: limit }), this.repo.db.transaction.count({ where })]);
    return { items, total, page, limit };
  }
  async detail(id: number, userId: number) {
    const transaction = await this.repo.db.transaction.findUnique({ where: { id }, include: { revenueAllocations: true } });
    if (!transaction) throw new AppError(404, "Transaction not found");
    if (transaction.userId !== userId && !transaction.revenueAllocations.some(item => item.userId === userId)) throw new AppError(403, "Transaction belongs to another user");
    return { ...transaction, revenueAllocations: transaction.revenueAllocations.filter(item => item.userId === userId) };
  }
}
