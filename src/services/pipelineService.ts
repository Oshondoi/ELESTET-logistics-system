import { supabase } from '../lib/supabase'
import type { AccountPipelineStage, BatchPipelineStage, PartnerBatchInfo, FulfillmentStage } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ── Конфигурация пайплайна аккаунта ─────────────────────────

export async function fetchAccountPipeline(accountId: string): Promise<AccountPipelineStage[]> {
  const { data, error } = await db.rpc('get_account_pipeline', { p_account_id: accountId })
  if (error) throw error
  return (data ?? []) as AccountPipelineStage[]
}

export async function saveAccountPipeline(
  accountId: string,
  stages: Array<{
    name: string
    partner_account_id: string | null
    stage_otk: boolean
    stage_packaging: boolean
    stage_marking: boolean
    stage_packing: boolean
    stage_logistics: boolean
  }>
): Promise<void> {
  // Удаляем все существующие и вставляем заново (наиболее надёжный подход)
  const { error: delErr } = await db
    .from('account_pipeline_stages')
    .delete()
    .eq('account_id', accountId)
  if (delErr) throw delErr

  if (stages.length === 0) return

  const rows = stages.map((s, i) => ({
    account_id: accountId,
    order_index: i,
    name: s.name,
    partner_account_id: s.partner_account_id,
    stage_otk: s.stage_otk,
    stage_packaging: s.stage_packaging,
    stage_marking: s.stage_marking,
    stage_packing: s.stage_packing,
    stage_logistics: s.stage_logistics,
  }))

  const { error } = await db.from('account_pipeline_stages').insert(rows)
  if (error) throw error
}

// ── Пайплайн партии ──────────────────────────────────────────

export async function fetchBatchPipeline(batchId: string): Promise<BatchPipelineStage[]> {
  const { data, error } = await db
    .from('batch_pipeline_stages')
    .select('*')
    .eq('batch_id', batchId)
    .order('order_index')
  if (error) throw error
  return (data ?? []) as BatchPipelineStage[]
}

export async function fetchAllBatchPipelineStages(batchIds: string[]): Promise<BatchPipelineStage[]> {
  if (!batchIds.length) return []
  const { data, error } = await db
    .from('batch_pipeline_stages')
    .select('*')
    .in('batch_id', batchIds)
    .order('order_index')
  if (error) throw error
  return (data ?? []) as BatchPipelineStage[]
}

export async function initBatchPipeline(batchId: string, accountId: string): Promise<void> {
  const { data, error } = await db.rpc('init_batch_pipeline', {
    p_batch_id: batchId,
    p_account_id: accountId,
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error as string)
}

export async function completeBatchPipelineStage(
  stageId: string
): Promise<{ next_stage_id: string | null }> {
  const { data, error } = await db.rpc('complete_batch_pipeline_stage', { p_stage_id: stageId })
  if (error) throw error
  if (data?.error) throw new Error(data.error as string)
  return { next_stage_id: (data?.next_stage_id as string) ?? null }
}

export async function advanceBatchPipelineStep(stageId: string, newStep: FulfillmentStage): Promise<void> {
  const { error } = await db
    .from('batch_pipeline_stages')
    .update({ current_stage: newStep, updated_at: new Date().toISOString() })
    .eq('id', stageId)
  if (error) throw error
}

// ── Партнёрские партии ───────────────────────────────────────

export async function fetchPartnerBatches(accountId: string): Promise<PartnerBatchInfo[]> {
  const { data, error } = await db.rpc('get_partner_batches', { p_account_id: accountId })
  if (error) throw error
  return (data ?? []) as PartnerBatchInfo[]
}
