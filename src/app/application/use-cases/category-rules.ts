import { CategoryRule, foldText, matchRule, RULE_MAX_LENGTH, RULE_MIN_LENGTH } from '../../domain/rules';
import { normalizeTags } from '../../domain/transaction';
import { NotFoundError, ValidationError } from '../errors';
import { IAccountRepository, ICategoryRepository, ICategoryRuleRepository, IdGenerator, ITransactionRepository } from '../ports/repositories';

export interface RuleFields {
  match: string;
  categoryId: string;
  accountId?: string | null;
  tag?: string | null;
}

export class SaveCategoryRule {
  constructor(
    private readonly rules: ICategoryRuleRepository,
    private readonly categories: ICategoryRepository,
    private readonly accounts: IAccountRepository,
    private readonly ids: IdGenerator,
  ) {}

  /** Crea la regla, o la edita si llega `id`. Dos reglas no pueden buscar el mismo texto. */
  async execute(input: RuleFields, id?: string): Promise<CategoryRule> {
    const match = input.match.replace(/\s+/g, ' ').trim();
    if (match.length < RULE_MIN_LENGTH || match.length > RULE_MAX_LENGTH) throw new ValidationError('ruleMatch');
    if (!(await this.categories.get(input.categoryId))) throw new NotFoundError('category');
    if (input.accountId && !(await this.accounts.get(input.accountId))) throw new NotFoundError('account');
    const existing = await this.rules.list();
    if (id && !existing.some((r) => r.id === id)) throw new NotFoundError('rule');
    if (existing.some((r) => r.id !== id && foldText(r.match) === foldText(match))) throw new ValidationError('ruleDuplicate');
    const rule: CategoryRule = {
      id: id ?? this.ids.next(),
      match,
      categoryId: input.categoryId,
      accountId: input.accountId || null,
      tag: normalizeTags(input.tag ?? '')[0] ?? null,
    };
    await this.rules.save(rule);
    return rule;
  }
}

export class DeleteCategoryRule {
  constructor(private readonly rules: ICategoryRuleRepository) {}

  execute(id: string): Promise<void> {
    return this.rules.delete(id);
  }
}

/**
 * Pasa a la categoría de la regla (y le pone su etiqueta) los movimientos que ya existen y cuya nota coincide. No
 * cambia su cuenta, porque eso cambiaría saldos pasados; tampoco toca divididos ni pasa un ingreso a gasto.
 */
export class ApplyRuleToPast {
  constructor(
    private readonly rules: ICategoryRuleRepository,
    private readonly transactions: ITransactionRepository,
    private readonly categories: ICategoryRepository,
  ) {}

  /** Cuántos movimientos cambió. */
  async execute(ruleId: string): Promise<number> {
    const rule = (await this.rules.list()).find((r) => r.id === ruleId);
    if (!rule) throw new NotFoundError('rule');
    const categories = new Map((await this.categories.list()).map((c) => [c.id, c]));
    const target = categories.get(rule.categoryId);
    if (!target) throw new NotFoundError('category');
    const isIncome = target.type === 'ingreso';
    let changed = 0;
    for (const t of await this.transactions.listAll()) {
      if (t.splits?.length || !matchRule(t.note, [rule])) continue;
      const current = categories.get(t.categoryId);
      if (current && (current.type === 'ingreso') !== isIncome) continue;
      const tags = rule.tag ? normalizeTags([...(t.tags ?? []), rule.tag]) : (t.tags ?? []);
      if (t.categoryId === rule.categoryId && tags.length === (t.tags ?? []).length) continue;
      await this.transactions.save({ ...t, categoryId: rule.categoryId, tags });
      changed++;
    }
    return changed;
  }
}
