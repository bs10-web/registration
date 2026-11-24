"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key) : null;

export type Course = {
  id: string;
  category: string;
  name: string;
  capacity: number;
  count: number;
  startsAt: string;
  endsAt: string;
  state?: "upcoming" | "open" | "full" | "closed";
};

export type RpcResult<T = Record<string, unknown>> = T & {
  ok?: boolean;
  message?: string;
};

export async function rpc<T>(name: string, args?: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase 설정을 확인해주세요.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    console.error(`RPC ${name} failed`, error.code);
    throw new Error("요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
  return data as T;
}
