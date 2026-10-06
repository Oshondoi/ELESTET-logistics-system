import { supabase } from "../lib/supabase";
import type {
  ExecutorAccountSearchResult,
  ServiceRequest,
  ServiceRequestItemDraft,
  ServiceRequestStore,
  RequestSupplyDraft,
} from "../types";

const client = () => {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase as any;
};

const throwRpc = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || "Не удалось выполнить действие");
};

export const getRequestDraftDeviceId = (): string => {
  const key = "elestet-request-draft-device";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
};

export const fetchServiceRequests = async (
  accountId: string,
): Promise<ServiceRequest[]> => {
  const { data, error } = await client()
    .from("service_requests")
    .select("*, stores:service_request_stores(*)")
    .or(
      `applicant_account_id.eq.${accountId},executor_account_id.eq.${accountId}`,
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: ServiceRequest) => ({
    ...row,
    stores: (row.stores ?? [])
      .filter((store) => !store.deleted_at)
      .sort((a, b) => a.position - b.position),
  }));
};

export interface ServiceRequestVersion {
  id: string;
  version: number;
  event_type: "submitted" | "corrected" | "accepted" | "rejected" | "cancelled";
  snapshot: {
    request?: Record<string, unknown>;
    stores?: Array<{ id: string; payload?: {
      items?: ServiceRequestItemDraft[];
      supplies?: RequestSupplyDraft[];
    } }>;
  };
  confirmed_at: string;
}

export const fetchServiceRequestVersions = async (requestId: string): Promise<ServiceRequestVersion[]> => {
  const { data, error } = await client().from("service_request_versions")
    .select("id,version,event_type,snapshot,confirmed_at")
    .eq("request_id", requestId).order("version", { ascending: false });
  throwRpc(error);
  return (data ?? []) as ServiceRequestVersion[];
};

export const createServiceRequestDraft = async (
  accountId: string,
  executorAccountId?: string | null,
): Promise<ServiceRequest> => {
  const { data, error } = await client().rpc("create_service_request_draft", {
    p_applicant_account_id: accountId,
    p_executor_account_id: executorAccountId ?? null,
    p_title: "",
  });
  throwRpc(error);
  return data as ServiceRequest;
};

export const createServiceRequestFromForm = async (
  accountId: string,
  input: Omit<SaveRequestDraftInput, "stores">,
  inviteToken?: string | null,
): Promise<ServiceRequest> => {
  const { data, error } = await client().rpc("create_service_request_from_form", {
    p_applicant_account_id: accountId,
    p_executor_account_id: input.executorAccountId,
    p_title: input.title,
    p_applicant_name: input.applicantName,
    p_applicant_email: input.applicantEmail,
    p_comment: input.comment,
    p_invite_token: inviteToken ?? null,
  });
  throwRpc(error);
  return data as ServiceRequest;
};

export const removeServiceRequests = async (requestIds: string[]) => {
  const { data, error } = await client().rpc("remove_service_requests", {
    p_request_ids: requestIds,
  });
  throwRpc(error);
  return data as { deleted: number; cancelled: number };
};

export const reassignRejectedServiceRequest = async (requestId: string, executorAccountId: string) => {
  const { error } = await client().rpc("reassign_rejected_service_request", {
    p_request_id: requestId, p_executor_account_id: executorAccountId,
  });
  throwRpc(error);
};

export const fetchRecentExecutorAccounts = async (
  applicantAccountId: string,
): Promise<ExecutorAccountSearchResult[]> => {
  const { data, error } = await client().rpc("list_recent_request_executors", {
    p_applicant_account_id: applicantAccountId,
  });
  throwRpc(error);
  return (data ?? []) as ExecutorAccountSearchResult[];
};

export interface PublicRequestInvite {
  invite_id: string;
  executor_account_id: string;
  executor_short_id: number;
  executor_name: string;
  applicant_account_id: string | null;
  applicant_short_id: number | null;
  applicant_name: string | null;
  expires_at: string;
  is_available: boolean;
  state: "active" | "reserved" | "bound" | "replaced" | "expired" | "deleted";
  unavailable_reason: string | null;
  reserved_email: string | null;
  reserved_name: string | null;
  email_confirmed: boolean | null;
  reserve_draft: Record<string, unknown> | null;
}

export const getPublicServiceRequestInvite = async (
  token: string,
): Promise<PublicRequestInvite> => {
  const { data, error } = await client().rpc("get_service_request_invite", {
    p_token: token,
  });
  throwRpc(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Ссылка не найдена");
  return row;
};

export const reserveServiceRequestInvite = async (
  token: string,
  fullName: string,
  email: string,
) => {
  const { data, error } = await client().rpc("reserve_service_request_invite", {
    p_token: token,
    p_full_name: fullName,
    p_email: email,
  });
  throwRpc(error);
  return data as {
    ok: boolean;
    code?: string;
    invite_id?: string;
    token?: string;
    expires_at?: string;
  };
};

export const replaceServiceRequestInviteReserve = async (token: string) => {
  const { data, error } = await client().rpc(
    "replace_service_request_invite_reserve",
    { p_token: token },
  );
  throwRpc(error);
  return data as { ok: true; expires_at: string };
};

export const accountHasActiveRequestInvite = async (accountId: string) => {
  const { data, error } = await client().rpc(
    "account_has_active_request_invite",
    { p_account_id: accountId },
  );
  throwRpc(error);
  return Boolean(data);
};

export const listRequestInviteBindableAccountIds = async (): Promise<
  string[]
> => {
  const { data, error } = await client().rpc(
    "list_request_invite_bindable_accounts",
  );
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { account_id: string }) => row.account_id);
};

export const saveServiceRequestInviteReserve = async (
  token: string,
  draft: Record<string, unknown>,
) => {
  const { data, error } = await client().rpc(
    "save_service_request_invite_reserve",
    { p_token: token, p_draft: draft, p_device_id: getRequestDraftDeviceId() },
  );
  throwRpc(error);
  return data as { ok: boolean };
};

export interface MyRequestReserve {
  invite_id: string;
  executor_account_id: string;
  executor_short_id: number;
  executor_name: string;
  full_name: string;
  email: string;
  draft: Record<string, unknown>;
  expires_at: string;
  link_active: boolean;
}

export const listMyRequestReserves = async (): Promise<MyRequestReserve[]> => {
  const { data, error } = await client().rpc("list_my_request_reserves");
  throwRpc(error);
  return (data ?? []) as MyRequestReserve[];
};

export const openMyRequestReserve = async (inviteId: string): Promise<Record<string, unknown>> => {
  const { data, error } = await client().rpc("open_my_request_reserve", {
    p_invite_id: inviteId, p_device_id: getRequestDraftDeviceId(),
  });
  throwRpc(error);
  return (data ?? {}) as Record<string, unknown>;
};

export const heartbeatMyRequestReserve = async (inviteId: string): Promise<boolean> => {
  const { data, error } = await client().rpc("heartbeat_my_request_reserve", {
    p_invite_id: inviteId, p_device_id: getRequestDraftDeviceId(),
  });
  throwRpc(error);
  return Boolean(data);
};

export const saveMyRequestReserve = async (
  inviteId: string,
  draft: Record<string, unknown>,
) => {
  const { error } = await client().rpc("save_my_request_reserve", {
    p_invite_id: inviteId,
    p_draft: draft,
    p_device_id: getRequestDraftDeviceId(),
  });
  throwRpc(error);
};

export const submitMyRequestReserve = async (
  inviteId: string,
  values: {
    companyName: string;
    applicantName: string;
    applicantEmail: string;
    title: string;
    comment: string;
    executorAccountId: string;
    applicantAccountId?: string | null;
    stores: ReservedInviteStore[];
  },
) => {
  const { data, error } = await client().rpc("submit_my_request_reserve", {
    p_invite_id: inviteId,
    p_company_name: values.companyName,
    p_applicant_name: values.applicantName,
    p_applicant_email: values.applicantEmail,
    p_title: values.title,
    p_comment: values.comment,
    p_stores: values.stores,
    p_executor_account_id: values.executorAccountId,
    p_applicant_account_id: values.applicantAccountId ?? null,
    p_device_id: getRequestDraftDeviceId(),
  });
  throwRpc(error);
  return data as { ok: true; account_id: string; request_id: string };
};

export interface ReservedInviteStore {
  store_id?: string;
  name: string;
  marketplace: string;
  delivery_mode: "pickup" | "self_delivery";
  intake_mode: "bulk" | "catalog" | "barcodes" | "boxes";
  items: ServiceRequestItemDraft[];
  supplies?: RequestSupplyDraft[];
  position: number;
}

export const submitServiceRequestInviteReserve = async (
  token: string,
  values: {
    companyName: string;
    applicantName: string;
    applicantEmail: string;
    title: string;
    comment: string;
    executorAccountId: string;
    stores: ReservedInviteStore[];
  },
) => {
  const { data, error } = await client().rpc(
    "submit_service_request_invite_reserve",
    {
      p_token: token,
      p_company_name: values.companyName,
      p_applicant_name: values.applicantName,
      p_applicant_email: values.applicantEmail,
      p_title: values.title,
      p_comment: values.comment,
      p_stores: values.stores,
      p_executor_account_id: values.executorAccountId,
      p_device_id: getRequestDraftDeviceId(),
    },
  );
  if (error) throw new Error(error.message);
  return data as { ok: true; account_id: string; request_id: string };
};

export interface AdminInvitePreview {
  invite_id: string;
  state: string;
  expires_at?: string;
  ended_at?: string | null;
  end_reason?: string | null;
  email?: string | null;
  email_confirmed?: boolean | null;
  auth_created_at?: string | null;
  company_created_at?: string | null;
  executor: { id: string; short_id: number; name: string };
  applicant: { id: string; short_id: number; name: string } | null;
  reserve: {
    email: string;
    full_name: string;
    expires_at: string;
    draft: Record<string, unknown>;
  } | null;
  requests: Array<{
    id: string;
    short_id: number;
    status: string;
    title: string;
    current_version: number;
  }>;
}

export const getAdminInvitePreview = async (token: string) => {
  const { data, error } = await client().rpc(
    "admin_preview_service_request_invite",
    { p_token: token },
  );
  if (error) throw new Error(error.message);
  return data as AdminInvitePreview;
};

export const claimServiceRequestInvite = async (
  token: string,
  applicantAccountId?: string | null,
  replaceExisting = false,
): Promise<ExecutorAccountSearchResult> => {
  const { data, error } = await client().rpc("claim_service_request_invite", {
    p_token: token,
    p_applicant_account_id: applicantAccountId ?? null,
    p_replace_existing: replaceExisting,
  });
  throwRpc(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Ссылка не найдена");
  return row as ExecutorAccountSearchResult;
};

export interface SaveRequestDraftInput {
  title: string;
  executorAccountId: string;
  executor?: ExecutorAccountSearchResult | null;
  applicantName: string;
  applicantEmail: string;
  comment: string;
  stores: Array<{
    store_id: string;
    position: number;
    delivery_mode: "pickup" | "self_delivery";
    intake_mode: "bulk" | "catalog" | "barcodes" | "boxes";
    payload: Record<string, unknown>;
  }>;
}

export const saveServiceRequestDraft = async (
  requestId: string,
  input: SaveRequestDraftInput,
): Promise<ServiceRequest> => {
  const { data, error } = await client().rpc("save_service_request_draft", {
    p_request_id: requestId,
    p_title: input.title,
    p_executor_account_id: input.executorAccountId,
    p_applicant_name: input.applicantName,
    p_applicant_email: input.applicantEmail,
    p_comment: input.comment,
    p_stores: input.stores,
  });
  throwRpc(error);
  return data as ServiceRequest;
};

export const fetchServiceRequestCorrectionDraft = async (
  requestId: string,
): Promise<Partial<SaveRequestDraftInput>> => {
  const { data, error } = await client()
    .from("service_request_correction_drafts")
    .select("draft")
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  return (data?.draft ?? {}) as Partial<SaveRequestDraftInput>;
};

export const openServiceRequestWorkDraft = async (
  requestId: string,
  deviceId: string,
): Promise<Partial<SaveRequestDraftInput>> => {
  const { data, error } = await client().rpc("open_service_request_work_draft", {
    p_request_id: requestId,
    p_device_id: deviceId,
  });
  throwRpc(error);
  return (data ?? {}) as Partial<SaveRequestDraftInput>;
};

export const heartbeatServiceRequestWorkDraft = async (
  requestId: string,
  deviceId: string,
): Promise<boolean> => {
  const { data, error } = await client().rpc("heartbeat_service_request_work_draft", {
    p_request_id: requestId,
    p_device_id: deviceId,
  });
  throwRpc(error);
  return Boolean(data);
};

export const saveServiceRequestWorkDraft = async (
  requestId: string,
  deviceId: string,
  draft: SaveRequestDraftInput,
) => {
  const { data, error } = await client().rpc("save_service_request_work_draft", {
    p_request_id: requestId,
    p_device_id: deviceId,
    p_draft: draft,
  });
  throwRpc(error);
  return data as { ok: boolean };
};

export const submitServiceRequest = async (requestId: string) => {
  const { data, error } = await client().rpc("submit_service_request", {
    p_request_id: requestId,
    p_device_id: getRequestDraftDeviceId(),
  });
  throwRpc(error);
  return data as { ok: boolean; version: number };
};

export const acceptServiceRequest = async (requestId: string) => {
  const { data, error } = await client().rpc("accept_service_request", {
    p_request_id: requestId,
  });
  throwRpc(error);
  return data as { ok: boolean };
};

export const rejectServiceRequest = async (
  requestId: string,
  comment: string,
) => {
  const { data, error } = await client().rpc("reject_service_request", {
    p_request_id: requestId,
    p_comment: comment,
  });
  throwRpc(error);
  return data as { ok: boolean };
};

export const assignServiceRequestResponsible = async (
  requestId: string,
  userId: string | null,
) => {
  const { data, error } = await client().rpc(
    "assign_service_request_responsible",
    {
      p_request_id: requestId,
      p_user_id: userId,
    },
  );
  throwRpc(error);
  return Boolean(data);
};

export const startServiceRequestWork = async (requestId: string) => {
  const { data, error } = await client().rpc("start_service_request_work", {
    p_request_id: requestId,
  });
  throwRpc(error);
  return Boolean(data);
};

export const copyServiceRequest = async (
  requestId: string,
): Promise<ServiceRequest> => {
  const { data, error } = await client().rpc("copy_service_request", {
    p_request_id: requestId,
  });
  throwRpc(error);
  return data as ServiceRequest;
};

export const searchExecutorAccounts = async (
  query: string,
): Promise<ExecutorAccountSearchResult[]> => {
  if (!query.trim()) return [];
  const { data, error } = await client().rpc("search_executor_accounts", {
    p_query: query.trim(),
  });
  throwRpc(error);
  return (data ?? []) as ExecutorAccountSearchResult[];
};

export const fetchRequestStoreRows = async (
  requestId: string,
): Promise<ServiceRequestStore[]> => {
  const { data, error } = await client()
    .from("service_request_stores")
    .select("*")
    .eq("request_id", requestId)
    .is("deleted_at", null)
    .order("position");
  if (error) throw error;
  return (data ?? []) as ServiceRequestStore[];
};

export interface RequestBatchSummary {
  id: string;
  short_id: number | null;
  name: string;
  status: string;
  current_stage: string;
  request_acceptance_status: string;
  documents: Array<{
    id: string;
    kind: "acceptance_act" | "invoice";
    revision: number;
    status: string;
    issued_at: string | null;
  }>;
}

export const fetchRequestBatchSummaries = async (
  batchIds: string[],
): Promise<RequestBatchSummary[]> => {
  if (batchIds.length === 0) return [];
  const { data, error } = await client()
    .from("fulfillment_batches")
    .select(
      "id,short_id,name,status,current_stage,request_acceptance_status,documents:fulfillment_batch_documents(id,kind,revision,status,issued_at)",
    )
    .in("id", batchIds)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? []) as RequestBatchSummary[];
};

export const createServiceRequestInvite = async (
  executorAccountId: string,
): Promise<{ token: string; expires_at: string }> => {
  const { data, error } = await client().rpc("create_service_request_invite", {
    p_executor_account_id: executorAccountId,
  });
  throwRpc(error);
  return data as { token: string; expires_at: string };
};
