// CostRepository — read methods for the Cost tab.
//
// Delegates the kind-filtered SUM to Aggregates (the single source of the
// exclusion rules) and switches the group key for conversation / provider /
// model grouping. For conversation grouping it resolves the human label from
// the conversations table; provider/model groups label themselves by key.
import { Injectable } from '@nestjs/common';
import type { TimeWindow, CostGroup, CostGroupBy } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { Aggregates, type CostGroupKey } from './aggregates';

export interface CostGroupByInput {
  userId: string;
  window: TimeWindow;
  groupBy: CostGroupBy;
  includeReplay?: boolean;
  includeMock?: boolean;
  includeSample?: boolean;
  currentSampleWorkspaceId?: string | null;
}

export interface CostGroupByResult {
  groups: CostGroup[];
  totalMicroUsd: number;
  unpricedModels: string[];
}

@Injectable()
export class CostRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregates: Aggregates,
  ) {}

  async groupBy(input: CostGroupByInput): Promise<CostGroupByResult> {
    const by: CostGroupKey = input.groupBy === 'conversation' ? 'conversationId' : input.groupBy;
    const result = await this.aggregates.costGrouped(
      {
        userId: input.userId,
        window: input.window,
        includeReplay: input.includeReplay,
        includeMock: input.includeMock,
        includeSample: input.includeSample,
        currentSampleWorkspaceId: input.currentSampleWorkspaceId,
      },
      by,
    );

    let labelFor: (key: string) => string = (k) => k;
    if (input.groupBy === 'conversation') {
      const convs = await this.prisma.db.conversation.findMany({ where: { userId: input.userId } });
      const titles = new Map(convs.map((c) => [c.id, c.title]));
      labelFor = (k) => titles.get(k) ?? k;
    }

    const groups: CostGroup[] = result.groups.map((g) => ({
      key: g.key,
      label: labelFor(g.key),
      promptCostMicros: g.promptCostMicros,
      completionCostMicros: g.completionCostMicros,
      totalCostMicros: g.totalCostMicros,
      unpricedCount: g.unpricedCount,
    }));

    return { groups, totalMicroUsd: result.totalMicroUsd, unpricedModels: result.unpricedModels };
  }
}
