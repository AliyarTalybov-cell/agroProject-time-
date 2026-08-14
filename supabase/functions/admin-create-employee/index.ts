// Supabase Edge Function: admin-create-employee
// Creates Auth user + upserts public.profiles using service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type EmployeeRole = 'worker' | 'manager'

type Payload = {
  accessToken?: string
  fullName: string
  email: string
  phone?: string | null
  position?: string | null
  additionalInfo?: string | null
  role: EmployeeRole
  password: string
}

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
  if (!url || !anonKey || !serviceRoleKey) {
    return json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY or SERVICE_ROLE_KEY' }, { status: 500 })
  }

  let body: Payload
  try {
    body = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Verify caller (must be authenticated manager)
  const token = body.accessToken ? String(body.accessToken) : ''
  if (!token) return json({ error: 'Unauthorized' }, { status: 401 })
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, { status: 401 })
  const callerRole = (userData.user.user_metadata as { role?: string } | null)?.role
  if (callerRole !== 'manager') return json({ error: 'Forbidden' }, { status: 403 })

  const fullName = String(body.fullName ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const role = (body.role === 'manager' ? 'manager' : 'worker') as EmployeeRole
  const phone = body.phone != null ? String(body.phone).trim() || null : null
  const position = body.position != null ? String(body.position).trim() || null : null
  const additionalInfo = body.additionalInfo != null ? String(body.additionalInfo).trim() || null : null

  if (fullName.length < 2) return json({ error: 'fullName is required' }, { status: 400 })
  if (!email || !email.includes('@')) return json({ error: 'email is required' }, { status: 400 })
  if (!password || password.length < 6) return json({ error: 'password must be at least 6 chars' }, { status: 400 })

  const supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Create Auth user (confirmed to allow immediate login)
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role,
      phone,
      position,
      additional_info: additionalInfo,
      active: true,
    },
  })

  if (createErr) {
    return json({ error: createErr.message }, { status: 400 })
  }
  const userId = created.user?.id
  if (!userId) return json({ error: 'Auth user not created' }, { status: 500 })

  // Upsert profile row
  const now = new Date().toISOString()
  const { error: upsertErr } = await supabaseAdmin.from('profiles').upsert(
    {
      id: userId,
      email,
      display_name: fullName,
      role,
      active: true,
      phone,
      position,
      additional_info: additionalInfo,
      updated_at: now,
    },
    { onConflict: 'id' },
  )

  if (upsertErr) {
    // Keep auth/profiles consistency: best-effort rollback of created auth user.
    const { error: rollbackErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (rollbackErr) {
      console.error('[admin-create-employee] rollback auth user failed', rollbackErr)
    }
    return json({ error: upsertErr.message }, { status: 400 })
  }

  return json({ id: userId })
})

