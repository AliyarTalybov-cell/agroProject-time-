import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-headers', 'authorization, x-client-info, apikey, content-type')
  headers.set('access-control-allow-methods', 'POST, OPTIONS')
  return new Response(JSON.stringify(data), { ...init, headers })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'Missing env' }, { status: 500 })

  let body: { id?: string; accessToken?: string }
  try {
    body = (await req.json()) as { id?: string; accessToken?: string }
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const token = body.accessToken ? String(body.accessToken) : ''
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 })

  const authHeader = req.headers.get('authorization') ?? ''
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, { status: 401 })
  const callerRole = (userData.user.user_metadata as { role?: string } | null)?.role
  if (callerRole !== 'manager') return json({ error: 'Forbidden' }, { status: 403 })

  const id = String(body.id ?? '').trim()
  if (!id) return json({ error: 'id is required' }, { status: 400 })

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: delErr } = await admin.auth.admin.deleteUser(id)
  if (delErr) return json({ error: delErr.message }, { status: 400 })

  const { error: profileErr } = await admin.from('profiles').delete().eq('id', id)
  if (profileErr) return json({ error: `User deleted, profile cleanup failed: ${profileErr.message}` }, { status: 400 })

  return json({ ok: true })
})

